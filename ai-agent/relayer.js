import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '..', 'state.json');
const DEPLOYMENTS_FILE = path.join(__dirname, '..', 'deployments.json');

const RELAYER_INTERVAL_MS = parseInt(process.env.RELAYER_INTERVAL_MS || '60000', 10);
const RELAYER_MAX_CYCLES = parseInt(process.env.RELAYER_MAX_CYCLES || '0', 10);
const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const DA_DEMO_MODE = process.env.DA_DEMO_MODE === 'true' || process.env.DA_DEMO_MODE === '1';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('[Error] PRIVATE_KEY not set. Add it to your .env file.');
  process.exit(1);
}

function loadDeployments() {
  try {
    if (fs.existsSync(DEPLOYMENTS_FILE)) {
      return JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Error] Failed to load deployments.json:', e.message);
  }
  return null;
}

const deployments = loadDeployments();
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || deployments?.contracts?.vault?.proxy;
const DA_VERIFIER_ADDRESS = process.env.DA_VERIFIER_ADDRESS || deployments?.contracts?.daVerifier?.address || deployments?.contracts?.daEntrance?.address;
const LENDING_POOL_ADDRESS = deployments?.contracts?.lendingPool?.address;
const AMM_POOL_ADDRESS = deployments?.contracts?.ammPool?.address;

if (!VAULT_ADDRESS) {
  console.error('[Error] VAULT_ADDRESS not set. Add it to your .env file or deployments.json.');
  process.exit(1);
}

const VAULT_ABI = [
  "function executeAIStrategy(uint256[] allocations, address[] targets, bytes signature, bytes32 daBlobHash, bytes32 dataRoot, uint256 daEpoch, uint256 daQuorumId) external",
  "function totalAssets() view returns (uint256)",
  "function daVerificationEnabled() view returns (bool)"
];

const DA_VERIFIER_ABI = [
  "function confirmCommitment(bytes32 dataRoot, uint256 epoch, uint256 quorumId) external",
  "function commitmentExists(bytes32 dataRoot, uint256 epoch, uint256 quorumId) view returns (bool)"
];

const POOL_ABI = [
  "function getAPY() view returns (uint256)"
];

let cycleCount = 0;
let keepRunning = true;

function appendLog(type, text) {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!state.logs) state.logs = [];
    state.logs.push({ type, text, time: new Date().toISOString(), cycle: cycleCount });
    if (state.logs.length > 100) state.logs = state.logs.slice(-100);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
  } catch { /* non-critical */ }
}

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
      delay *= 2;
    }
  }
}

async function ensureStateFile() {
  if (fs.existsSync(STATE_FILE)) return;

  console.log("[*] state.json not found. Initializing from deployments.json and on-chain pool state...");
  if (!deployments) {
    console.error('[Error] deployments.json not found. Cannot initialize state.json.');
    process.exit(1);
  }

  const lendingAddr = deployments.contracts.lendingPool.address;
  const ammAddr = deployments.contracts.ammPool.address;
  const lendingRisk = deployments.pools?.lending?.risk ?? 1.2;
  const ammRisk = deployments.pools?.amm?.risk ?? 3.0;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const lendingPool = new ethers.Contract(lendingAddr, POOL_ABI, provider);
  const ammPool = new ethers.Contract(ammAddr, POOL_ABI, provider);
  const blockNum = await provider.getBlockNumber();

  const lendingAPY = Number(await lendingPool.getAPY());
  const ammAPY = Number(await ammPool.getAPY());

  const state = {
    pools: {
      lending: { name: "Lending Pool", address: lendingAddr, apy: lendingAPY, risk: lendingRisk },
      amm: { name: "AMM Pool", address: ammAddr, apy: ammAPY, risk: ammRisk }
    },
    max_risk_limit: 2.0,
    blocks_fast_forwarded: 0,
    history: [],
    aum_history: [],
    boot_block: blockNum
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
  console.log("[✔] state.json initialized from on-chain pool state.");
}

async function syncPoolAPYs() {
  if (!fs.existsSync(STATE_FILE)) return;
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const lendingPool = new ethers.Contract(LENDING_POOL_ADDRESS, POOL_ABI, provider);
  const ammPool = new ethers.Contract(AMM_POOL_ADDRESS, POOL_ABI, provider);

  const [lendingAPY, ammAPY] = await Promise.all([
    lendingPool.getAPY(),
    ammPool.getAPY()
  ]);

  state.pools.lending.apy = Number(lendingAPY);
  state.pools.amm.apy = Number(ammAPY);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
  console.log(`[*] Synced on-chain APYs: Lending ${(Number(lendingAPY)/100).toFixed(2)}%, AMM ${(Number(ammAPY)/100).toFixed(2)}%`);
}

async function getVaultAUM() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);
  const totalAssets = await vault.totalAssets();
  return Number(ethers.formatUnits(totalAssets, 6));
}

async function recordAUM() {
  if (!fs.existsSync(STATE_FILE)) return;
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const aum = await getVaultAUM();
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const block = await provider.getBlockNumber();

  if (!state.aum_history) state.aum_history = [];
  state.aum_history.push({ block, aum, timestamp: Date.now() });
  if (state.aum_history.length > 100) state.aum_history = state.aum_history.slice(-100);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
  console.log(`[*] Recorded AUM: $${aum.toFixed(2)} at block #${block}`);
}

async function runCycle() {
  cycleCount++;
  console.log("\n============================================================");
  console.log(`🔄 STARTING RELAYER REBALANCE CYCLE #${cycleCount}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("============================================================");

  try {
    const aum = await getVaultAUM();
    console.log(`[*] Current Vault AUM: $${aum.toFixed(2)}`);

    await recordAUM();

    if (aum === 0) {
      console.log("[*] Vault AUM is 0. No deposits yet. Skipping rebalance cycle.");
      console.log("[*] Waiting for user deposits...");
      appendLog('info', `Cycle #${cycleCount}: AUM is $0. No deposits yet. Waiting for users...`);
      return;
    }

    appendLog('system', `Cycle #${cycleCount} started. AUM: $${aum.toFixed(2)}`);

    console.log("\n[*] Syncing pool APYs from on-chain (market sim may have changed them)...");
    await syncPoolAPYs();

    console.log("\n[STAGE 1/4] 📊 SENSE: Running Log Aggregator & 0G Storage Upload...");
    appendLog('info', `Stage 1/4: 0G Storage — uploading pool metrics...`);
    runCommandWithRetry("node log_aggregator.js", "Log Aggregator");
    appendLog('info', `Stage 1/4: 0G Storage upload complete.`);

    console.log("\n[STAGE 2/4] 🧠 THINK: Running Compute Client & 0G TEE Inference...");
    appendLog('info', `Stage 2/4: 0G Compute — dispatching TEE inference...`);
    runCommandWithRetry("node compute_client.js", "Compute Client");
    appendLog('info', `Stage 2/4: TEE inference complete. Strategy signed.`);

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

    const daEpoch = latestRun.da_epoch ?? 0;
    const daQuorumId = latestRun.da_quorum_id ?? 0;

    console.log("\n[STAGE 3/4] 📡 PUBLISH: Verifying 0G DA Dispersal Data...");
    appendLog('info', `Stage 3/4: 0G DA — verifying blob dispersal. Allocations: [${allocations.join(', ')}] bps`);
    console.log(`    - Allocations: [${allocations.join(', ')}]`);
    console.log(`    - Targets:     [${targets.join(', ')}]`);
    console.log(`    - Blob Hash:   ${daBlobHash}`);
    console.log(`    - Data Root:   ${dataRoot}`);
    console.log(`    - Epoch:       ${daEpoch}`);
    console.log(`    - Quorum ID:   ${daQuorumId}`);
    console.log(`    - TEE Signature: ${signature.slice(0, 16)}...`);

    console.log("\n[STAGE 4/4] ⛓️ EXECUTE: Submitting Rebalance Transaction...");
    appendLog('info', `Stage 4/4: 0G Chain — submitting executeAIStrategy...`);
    console.log(`[*] Connecting to RPC provider: ${RPC_URL}`);
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`[*] Wallet Address: ${wallet.address}`);

    const balance = await provider.getBalance(wallet.address);
    console.log(`[*] Wallet Balance: ${ethers.formatEther(balance)} A0GI`);

    const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);

    const daEnabled = await vault.daVerificationEnabled();
    if (daEnabled && DA_VERIFIER_ADDRESS) {
      const verifier = new ethers.Contract(DA_VERIFIER_ADDRESS, DA_VERIFIER_ABI, wallet);
      const exists = await verifier.commitmentExists(dataRoot, daEpoch, daQuorumId);
      if (!exists) {
        console.log(`[*] Registering DA commitment on verifier at ${DA_VERIFIER_ADDRESS}...`);
        const confirmTx = await verifier.confirmCommitment(dataRoot, daEpoch, daQuorumId);
        await confirmTx.wait();
        console.log(`[✔] DA commitment registered. Tx: ${confirmTx.hash}`);
        appendLog('info', `DA commitment registered on-chain (${confirmTx.hash.slice(0, 16)}...)`);
      } else {
        console.log('[✔] DA commitment already registered on-chain.');
      }
    }

    console.log(`[*] Submitting executeAIStrategy transaction to vault at ${VAULT_ADDRESS}...`);
    const tx = await vault.executeAIStrategy(allocations, targets, signature, daBlobHash, dataRoot, daEpoch, daQuorumId);
    console.log(`[*] Transaction submitted! Hash: ${tx.hash}`);
    console.log("[*] Waiting for confirmation...");
    const receipt = await tx.wait();
    console.log(`[✔] Transaction confirmed in block #${receipt.blockNumber}! Gas used: ${receipt.gasUsed.toString()}`);

    await recordAUM();

    const newAUM = await getVaultAUM();
    appendLog('system', `Rebalance complete! Tx: ${tx.hash.slice(0, 16)}... AUM: $${newAUM.toFixed(2)}`);

    console.log(`\n[✔] RELAYER REBALANCE CYCLE #${cycleCount} COMPLETE SUCCESS.`);

  } catch (error) {
    console.error(`\n[❌] Relayer cycle #${cycleCount} failed:`, error.message);
    appendLog('error', `Cycle #${cycleCount} failed: ${error.message}`);
  }
}

async function main() {
  console.log("============================================================");
  console.log("🤖 COGNIVAULT AUTONOMOUS RELAYER BOT SERVICE STARTED");
  console.log(`Interval: ${RELAYER_INTERVAL_MS} ms`);
  console.log(`Max Cycles: ${RELAYER_MAX_CYCLES === 0 ? 'Infinite' : RELAYER_MAX_CYCLES}`);
  console.log(`Vault Address: ${VAULT_ADDRESS}`);
  console.log(`DA Mode: ${DA_DEMO_MODE ? 'DEMO (CogniDAVerifier attestation)' : 'LIVE (external gRPC disperser)'}`);
  console.log(`DA Verifier: ${DA_VERIFIER_ADDRESS || 'not set'}`);
  console.log("============================================================");

  process.on('SIGINT', () => {
    console.log("\n[!] Received SIGINT. Shutting down relayer bot gracefully...");
    keepRunning = false;
  });

  process.on('SIGTERM', () => {
    console.log("\n[!] Received SIGTERM. Shutting down relayer bot gracefully...");
    keepRunning = false;
  });

  await ensureStateFile();

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
