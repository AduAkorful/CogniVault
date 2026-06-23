import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZgFile, Indexer } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    state.latest_storage_root = tx.rootHash || rootHash;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
    console.log("[✔] Updated state.json with live root hash.");
  } catch (e) {
    console.error(`[Error] Live upload failed: ${e.message}`);
    process.exit(1);
  }
}

main();
