import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '..', 'state.json');

// Configuration variables
const MOCK_RELAYER = process.env.MOCK_RELAYER === 'true' || !process.env.PRIVATE_KEY;
const RELAYER_INTERVAL_MS = parseInt(process.env.RELAYER_INTERVAL_MS || '60000', 10);
const RELAYER_MAX_CYCLES = parseInt(process.env.RELAYER_MAX_CYCLES || '0', 10);
const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;

// Minimal ABI for executeAIStrategy
const VAULT_ABI = [
  "function executeAIStrategy(uint256[] allocations, address[] targets, bytes signature, bytes32 daBlobHash, bytes32 dataRoot) external"
];

let cycleCount = 0;
let keepRunning = true;

/**
 * Helper to run a command with retries and exponential backoff.
 */
function runCommandWithRetry(cmd, name, maxRetries = 3) {
  let attempt = 1;
  let delay = 1000;

  while (attempt <= maxRetries) {
    try {
      console.log(`[*] [${name}] Attempt ${attempt}/${maxRetries}: Executing...`);
      execSync(cmd, { stdio: 'inherit', cwd: __dirname });
      console.log(`[✔] [${name}] Completed successfully.`);
      return;
    } catch (error) {
      console.error(`[❌] [${name}] Attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) {
        throw new Error(`Pipeline stage [${name}] failed after ${maxRetries} attempts.`);
      }
      attempt++;
      console.log(`[*] Retrying in ${delay / 1000}s...`);
      execSync(`sleep ${delay / 1000}`);
      delay *= 2; // exponential backoff
    }
  }
}

/**
 * Executes one complete cycle of the CogniVault relayer pipeline.
 */
async function runCycle() {
  cycleCount++;
  console.log("\n============================================================");
  console.log(`🔄 STARTING RELAYER REBALANCE CYCLE #${cycleCount}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Mode: ${MOCK_RELAYER ? 'MOCK SIMULATION' : 'LIVE BLOCKCHAIN'}`);
  console.log("============================================================");

  try {
    // 1. SENSE: Snapshot APYs and upload to 0G Storage
    console.log("\n[STAGE 1/4] 📊 SENSE: Running Log Aggregator & 0G Storage Upload...");
    runCommandWithRetry("node log_aggregator.js", "Log Aggregator");

    // 2. THINK: Run Compute Client (optimizes, signs, disperses to 0G DA)
    console.log("\n[STAGE 2/4] 🧠 THINK: Running Compute Client & 0G TEE Inference...");
    runCommandWithRetry("node compute_client.js", "Compute Client");

    // Load the updated state to get latest strategy parameters
    if (!fs.existsSync(STATE_FILE)) {
      throw new Error(`State file not found at ${STATE_FILE}`);
    }
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!state.history || state.history.length === 0) {
      throw new Error("No execution history found in state.json.");
    }
    const latestRun = state.history[state.history.length - 1];

    const allocations = latestRun.allocations;
    const targets = latestRun.targets;
    const signature = `0x${latestRun.signature}`;
    const daBlobHash = `0x${latestRun.da_blob_hash}`;
    const dataRoot = `0x${latestRun.da_data_root}`;

    console.log("\n[STAGE 3/4] 📡 PUBLISH: Verifying 0G DA Dispersal Data...");
    console.log(`    - Allocations: [${allocations.join(', ')}]`);
    console.log(`    - Targets:     [${targets.join(', ')}]`);
    console.log(`    - Blob Hash:   ${daBlobHash}`);
    console.log(`    - Data Root:   ${dataRoot}`);
    console.log(`    - TEE Signature: ${signature.slice(0, 16)}...`);

    // 4. EXECUTE: Submit the rebalance transaction
    console.log("\n[STAGE 4/4] ⛓️ EXECUTE: Submitting Rebalance Transaction...");
    if (MOCK_RELAYER) {
      console.log("[*] Mock Relayer: Simulating on-chain transaction execution...");
      console.log(`    Calling executeAIStrategy on vault at ${VAULT_ADDRESS || '0x_MOCK_VAULT_ADDRESS_'} with parameters:`);
      console.log(`    - allocations:`, allocations);
      console.log(`    - targets:`, targets);
      console.log(`    - signature:`, signature);
      console.log(`    - daBlobHash:`, daBlobHash);
      console.log(`    - dataRoot:`, dataRoot);
      
      // Update simulated block height in state
      state.blocks_fast_forwarded += 100;
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
      console.log(`[✔] Mock Relayer execution complete. Incremented simulated blocks (+100).`);
    } else {
      if (!PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY is required for live transaction execution.");
      }
      if (!VAULT_ADDRESS) {
        throw new Error("VAULT_ADDRESS is required for live transaction execution.");
      }

      console.log(`[*] Connecting to RPC provider: ${RPC_URL}`);
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
      console.log(`[*] Wallet Address: ${wallet.address}`);

      const balance = await provider.getBalance(wallet.address);
      console.log(`[*] Wallet Balance: ${ethers.formatEther(balance)} ETH`);

      const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);

      console.log(`[*] Submitting executeAIStrategy transaction to vault at ${VAULT_ADDRESS}...`);
      const tx = await vault.executeAIStrategy(allocations, targets, signature, daBlobHash, dataRoot);
      console.log(`[*] Transaction submitted! Hash: ${tx.hash}`);
      console.log("[*] Waiting for confirmation...");
      const receipt = await tx.wait();
      console.log(`[✔] Transaction confirmed in block #${receipt.blockNumber}! Gas used: ${receipt.gasUsed.toString()}`);
    }

    console.log(`\n[✔] RELAYER REBALANCE CYCLE #${cycleCount} COMPLETE SUCCESS.`);

  } catch (error) {
    console.error(`\n[❌] Relayer cycle #${cycleCount} failed:`, error.message);
  }
}

/**
 * Main loop controller.
 */
async function main() {
  console.log("============================================================");
  console.log("🤖 COGNIVAULT AUTONOMOUS RELAYER BOT SERVICE STARTED");
  console.log(`Interval: ${RELAYER_INTERVAL_MS} ms`);
  console.log(`Max Cycles: ${RELAYER_MAX_CYCLES === 0 ? 'Infinite' : RELAYER_MAX_CYCLES}`);
  console.log(`Storage Mode: ${process.env.MOCK_STORAGE === 'true' ? 'MOCK' : 'LIVE'}`);
  console.log(`Compute Mode: ${process.env.MOCK_COMPUTE === 'true' ? 'MOCK' : 'LIVE'}`);
  console.log(`DA Mode: ${process.env.MOCK_DA === 'true' ? 'MOCK' : 'LIVE'}`);
  console.log(`Relayer Mode: ${MOCK_RELAYER ? 'MOCK' : 'LIVE'}`);
  console.log("============================================================");

  // Setup graceful shutdown handlers
  process.on('SIGINT', () => {
    console.log("\n[!] Received SIGINT. Shutting down relayer bot gracefully...");
    keepRunning = false;
  });

  process.on('SIGTERM', () => {
    console.log("\n[!] Received SIGTERM. Shutting down relayer bot gracefully...");
    keepRunning = false;
  });

  while (keepRunning) {
    await runCycle();

    if (RELAYER_MAX_CYCLES > 0 && cycleCount >= RELAYER_MAX_CYCLES) {
      console.log(`\n[✔] Reached configured maximum cycles (${RELAYER_MAX_CYCLES}). Exiting...`);
      break;
    }

    if (!keepRunning) break;

    console.log(`\n[*] Sleeping for ${RELAYER_INTERVAL_MS / 1000} seconds before next cycle...`);
    await new Promise(resolve => setTimeout(resolve, RELAYER_INTERVAL_MS));
  }

  console.log("[*] Relayer bot service terminated.");
}

main();
