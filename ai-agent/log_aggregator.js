import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZgFile, Indexer, StorageNode, selectNodes, getFlowContract, Uploader } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const STATE_FILE = path.join(__dirname, '..', 'state.json');
const DB_FILE = path.join(__dirname, 'yield_db.json');
const EXPORT_FILE = path.join(__dirname, 'yield_metrics.json');

const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const INDEXER_URL = process.env.INDEXER_URL || 'https://indexer-storage-testnet-turbo.0g.ai';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('[Error] PRIVATE_KEY not set. Add it to your .env file.');
  process.exit(1);
}

async function main() {
  console.log("============================================================");
  console.log("📊 COGNIVAULT PERIODIC DB LOG AGGREGATOR");
  console.log(`Mode: LIVE PRODUCTION`);
  console.log("============================================================");

  if (!fs.existsSync(STATE_FILE)) {
    console.error(`[Error] state.json not found at ${STATE_FILE}`);
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  const lendingAPY = state.pools.lending.apy;
  const ammAPY = state.pools.amm.apy;
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const blockNum = await provider.getBlockNumber();
  const riskLimit = state.max_risk_limit;

  let db = [];
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.warn("[Warning] yield_db.json invalid or empty, recreating...");
    }
  }

  const newEntry = {
    timestamp: new Date().toISOString(),
    block: blockNum,
    lending_apy: lendingAPY,
    amm_apy: ammAPY,
    risk_limit: riskLimit
  };
  db.push(newEntry);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  console.log(`[✔] Logged new metrics to local DB:`);
  console.log(`    Block: #${newEntry.block} | Lending APY: ${(newEntry.lending_apy/100).toFixed(2)}% | AMM APY: ${(newEntry.amm_apy/100).toFixed(2)}%`);

  fs.writeFileSync(EXPORT_FILE, JSON.stringify(db, null, 2), 'utf8');

  console.log("\n[*] Initializing Live 0G Storage Upload...");

  try {
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);
    const indexer = new Indexer(INDEXER_URL);

    console.log(`Connecting to Indexer: ${INDEXER_URL}`);
    console.log(`RPC Provider: ${RPC_URL}`);

    // --- NODE HEALTH & SYNC CHECK ---
    console.log("\n[*] Fetching trusted nodes and checking sync height gaps...");
    const shardedNodes = await indexer.getShardedNodes();
    const trustedNodes = shardedNodes.trusted || [];
    console.log(`Retrieved ${trustedNodes.length} trusted nodes from indexer.`);

    const healthyNodes = [];
    for (const node of trustedNodes) {
      try {
        const client = new StorageNode(node.url);
        // Query status with a 5-second timeout to avoid hanging on offline nodes
        const status = await Promise.race([
          client.getStatus(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]);

        if (status) {
          const logSyncHeight = status.logSyncHeight;
          const gap = blockNum - logSyncHeight;
          console.log(`Node ${node.url} (shardId ${node.config.shardId}/${node.config.numShard}) status: logSyncHeight=${logSyncHeight}, gap=${gap}`);
          
          node.syncGap = gap;
          node.isOnline = true;
          healthyNodes.push(node);
        }
      } catch (err) {
        console.warn(`Node ${node.url} status check failed/timed out: ${err.message}`);
      }
    }

    if (healthyNodes.length === 0) {
      console.warn("Warning: No healthy/online nodes detected. Falling back to all trusted nodes.");
      for (const node of trustedNodes) {
        node.syncGap = 999999;
        node.isOnline = false;
        healthyNodes.push(node);
      }
    }

    // Sort healthy nodes by syncGap (ascending) to prioritize the most synchronized nodes
    healthyNodes.sort((a, b) => a.syncGap - b.syncGap);

    const expectedReplica = parseInt(process.env.EXPECTED_REPLICA || '1', 10);
    console.log(`Selecting nodes with expectedReplica = ${expectedReplica}...`);
    const [selected, ok] = selectNodes(healthyNodes, expectedReplica, 'min');
    if (!ok) {
      throw new Error(`Failed to select a subset of nodes meeting expectedReplica = ${expectedReplica}`);
    }
    console.log("Selected nodes for upload:", selected.map(n => n.url));

    const clients = selected.map((node) => new StorageNode(node.url));
    const firstStatus = await clients[0].getStatus();
    if (!firstStatus) {
      throw new Error("Failed to get status from the first selected node");
    }
    const flowContract = getFlowContract(firstStatus.networkIdentity.flowAddress, signer);
    
    // Instantiate custom uploader using selected nodes
    const uploader = new Uploader(clients, RPC_URL, flowContract);

    // --- GRACEFUL TIMEOUT & SKIP POLICY ---
    const SYNC_TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT_MS || '60000', 10);

    uploader.waitForLogEntry = async function(root, finalityRequired, txSeq, useTxSeq, onProgress) {
      console.log(`[Custom Uploader] Waiting for log entry with root ${root} (finalityRequired=${finalityRequired}, txSeq=${txSeq}, useTxSeq=${useTxSeq}). Timeout: ${SYNC_TIMEOUT_MS}ms`);
      const startTime = Date.now();
      
      while (true) {
        if (Date.now() - startTime > SYNC_TIMEOUT_MS) {
          throw new Error(`Timeout waiting for log entry on storage node after ${SYNC_TIMEOUT_MS}ms`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        let ok = true;
        let info = null;
        for (let client of this.nodes) {
          try {
            if (useTxSeq) {
              info = await client.getFileInfoByTxSeq(txSeq);
            } else {
              info = await client.getFileInfo(root, true);
            }
            
            if (info === null) {
              let logMsg = 'Waiting for storage node to sync...';
              let status = await client.getStatus();
              if (status !== null) {
                const logSyncHeight = status.logSyncHeight;
                const gap = blockNum - logSyncHeight;
                logMsg = `Waiting for storage node to sync (height=${logSyncHeight}, gap=${gap})...`;
              }
              console.log(logMsg);
              onProgress?.(logMsg);
              ok = false;
              break;
            }
            
            if (finalityRequired && !info.finalized) {
              const msg = 'Waiting for finality confirmation...';
              console.log(`Log entry is available, but not finalized yet on node ${client.url}:`, info);
              onProgress?.(msg);
              ok = false;
              break;
            }
          } catch (err) {
            console.warn(`Error querying file info from node ${client.url}: ${err.message}`);
            ok = false;
            break;
          }
        }
        
        if (ok && info !== null) {
          return info;
        }
      }
    };

    const file = await ZgFile.fromFilePath(EXPORT_FILE);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr !== null) {
      throw new Error(`Merkle tree error: ${treeErr}`);
    }

    const rootHash = tree.rootHash();
    console.log(`Calculated File Merkle Root Hash: ${rootHash}`);

    console.log("Uploading file to 0G Storage...");
    const uploadOpts = {
      expectedReplica,
    };
    
    let tx;
    try {
      const [result, uploadErr] = await uploader.splitableUpload(file, uploadOpts);
      if (uploadErr !== null) {
        throw uploadErr;
      }
      tx = {
        txHash: result.txHashes[0],
        rootHash: result.rootHashes[0],
        txSeq: result.txSeqs[0]
      };
      
      console.log("[✔] File uploaded successfully to 0G Storage!");
      console.log(`    - Transaction Hash: ${tx.txHash}`);
      console.log(`    - Merkle Root Hash: ${tx.rootHash || rootHash}`);
    } catch (e) {
      if (e.message.includes("Timeout")) {
        console.warn(`\n[⚠️] Live upload hit sync/finality timeout: ${e.message}`);
        console.warn("[⚠️] The transaction was likely submitted to the blockchain flow contract, but storage nodes are lagging.");
        console.warn("[⚠️] Proceeding with a graceful skip, using calculated root hash for state persistence.");
        tx = {
          txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
          rootHash: rootHash,
          txSeq: 0
        };
      } else {
        throw e;
      }
    }

    await file.close();

    state.latest_storage_root = tx.rootHash || rootHash;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
    console.log("[✔] Updated state.json with root hash.");
  } catch (e) {
    console.error(`[Error] Live upload failed: ${e.message}`);
    process.exit(1);
  }
}

main();
