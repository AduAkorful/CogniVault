import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZgFile, Indexer } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers, keccak256, getBytes } from 'ethers';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '..', 'state.json');
const DB_FILE = path.join(__dirname, 'yield_db.json');
const EXPORT_FILE = path.join(__dirname, 'yield_metrics.json');
const MOCK_STORAGE_DIR = path.join(__dirname, 'mock_0g_storage');

const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const INDEXER_URL = process.env.INDEXER_URL || 'https://indexer-storage-testnet-turbo.0g.ai';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MOCK_STORAGE = process.env.MOCK_STORAGE === 'true';

// Helper to compute a standard Merkle Tree & proof for mock mode
function computeMerkleTree(fileBuffer) {
  const CHUNK_SIZE = 1024;
  const leaves = [];
  
  for (let i = 0; i < fileBuffer.length; i += CHUNK_SIZE) {
    let chunk = fileBuffer.subarray(i, i + CHUNK_SIZE);
    if (chunk.length < CHUNK_SIZE) {
      const padded = new Uint8Array(CHUNK_SIZE);
      padded.set(chunk);
      chunk = padded;
    }
    leaves.push(keccak256(chunk));
  }
  
  if (leaves.length === 0) {
    const padded = new Uint8Array(CHUNK_SIZE);
    leaves.push(keccak256(padded));
  }

  const tree = [leaves];
  while (tree[tree.length - 1].length > 1) {
    const currentLevel = tree[tree.length - 1];
    const nextLevel = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const combined = new Uint8Array(64);
        combined.set(getBytes(currentLevel[i]), 0);
        combined.set(getBytes(currentLevel[i + 1]), 32);
        nextLevel.push(keccak256(combined));
      } else {
        const combined = new Uint8Array(64);
        combined.set(getBytes(currentLevel[i]), 0);
        combined.set(getBytes(currentLevel[i]), 32);
        nextLevel.push(keccak256(combined));
      }
    }
    tree.push(nextLevel);
  }

  const root = tree[tree.length - 1][0];
  return { root, tree };
}

function getProof(tree, index) {
  const proof = [];
  let currIdx = index;
  for (let lvl = 0; lvl < tree.length - 1; lvl++) {
    const level = tree[lvl];
    if (currIdx % 2 === 0) {
      const siblingIdx = currIdx + 1;
      if (siblingIdx < level.length) {
        proof.push(level[siblingIdx]);
      } else {
        proof.push(level[currIdx]);
      }
    } else {
      const siblingIdx = currIdx - 1;
      proof.push(level[siblingIdx]);
    }
    currIdx = Math.floor(currIdx / 2);
  }
  return proof;
}

async function main() {
  console.log("============================================================");
  console.log("📊 COGNIVAULT PERIODIC DB LOG AGGREGATOR");
  console.log(`Mode: ${MOCK_STORAGE ? 'MOCK / OFFLINE TEST' : 'LIVE PRODUCTION'}`);
  console.log("============================================================");

  // 1. Read current APYs and state
  if (!fs.existsSync(STATE_FILE)) {
    console.error(`[Error] state.json not found at ${STATE_FILE}`);
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  const lendingAPY = state.pools.lending.apy;
  const ammAPY = state.pools.amm.apy;
  const blockNum = state.blocks_fast_forwarded + 12800540; // baseline block
  const riskLimit = state.max_risk_limit;

  // 2. Load or initialize local database
  let db = [];
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.warn("[Warning] yield_db.json invalid or empty, recreating...");
    }
  }

  // 3. Append new log entry
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

  // 4. Export database for 0G upload
  fs.writeFileSync(EXPORT_FILE, JSON.stringify(db, null, 2), 'utf8');

  // 5. Upload to 0G Storage
  if (MOCK_STORAGE) {
    console.log("\n[*] Running in Mock/Offline mode...");
    if (!fs.existsSync(MOCK_STORAGE_DIR)) {
      fs.mkdirSync(MOCK_STORAGE_DIR, { recursive: true });
    }

    const fileContent = fs.readFileSync(EXPORT_FILE);
    const { root, tree } = computeMerkleTree(fileContent);

    // Write file to simulated storage
    const storageDest = path.join(MOCK_STORAGE_DIR, 'yield_metrics.json');
    fs.copyFileSync(EXPORT_FILE, storageDest);

    // Generate proofs for all chunks
    const CHUNK_SIZE = 1024;
    const proofs = [];
    const chunkCount = Math.ceil(fileContent.length / CHUNK_SIZE) || 1;
    for (let i = 0; i < chunkCount; i++) {
      proofs.push(getProof(tree, i));
    }

    // Save proof metadata
    const metadata = {
      rootHash: root,
      chunkCount,
      proofs
    };
    fs.writeFileSync(path.join(MOCK_STORAGE_DIR, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

    console.log("[✔] Simulated upload successful:");
    console.log(`    - Local Storage Destination: ${storageDest}`);
    console.log(`    - Calculated Merkle Root: ${root}`);

    // Update state.json with latest root hash
    state.latest_storage_root = root;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
    console.log("[✔] Updated state.json with simulated root hash.");
  } else {
    console.log("\n[*] Initializing Live 0G Storage Upload...");
    if (!PRIVATE_KEY) {
      console.error("[Error] PRIVATE_KEY is required for live 0G Storage uploads. Set it in .env or run with MOCK_STORAGE=true");
      process.exit(1);
    }

    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const signer = new ethers.Wallet(PRIVATE_KEY, provider);
      const indexer = new Indexer(INDEXER_URL);

      console.log(`Connecting to Indexer: ${INDEXER_URL}`);
      console.log(`RPC Provider: ${RPC_URL}`);

      const file = await ZgFile.fromFilePath(EXPORT_FILE);
      const [tree, treeErr] = await file.merkleTree();
      if (treeErr !== null) {
        throw new Error(`Merkle tree error: ${treeErr}`);
      }

      const rootHash = tree.rootHash();
      console.log(`Calculated File Merkle Root Hash: ${rootHash}`);

      console.log("Uploading file to 0G Storage...");
      const [tx, uploadErr] = await indexer.upload(file, RPC_URL, signer);
      if (uploadErr !== null) {
        throw new Error(`Upload error: ${uploadErr}`);
      }

      await file.close();

      console.log("[✔] File uploaded successfully to 0G Storage!");
      console.log(`    - Transaction Hash: ${tx.txHash}`);
      console.log(`    - Merkle Root Hash: ${tx.rootHash || rootHash}`);

      // Update state.json with actual root hash
      state.latest_storage_root = tx.rootHash || rootHash;
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
      console.log("[✔] Updated state.json with live root hash.");
    } catch (e) {
      console.error(`[Error] Live upload failed: ${e.message}`);
      process.exit(1);
    }
  }
}

main();
