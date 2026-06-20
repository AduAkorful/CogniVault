import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers, keccak256, getBytes, AbiCoder } from 'ethers';
import { createZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk';
import { disperseToDA, updateStateWithDA } from './da_client.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '..', 'state.json');
const DEPLOYMENTS_FILE = path.join(__dirname, '..', 'deployments.json');

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

const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('[Error] PRIVATE_KEY not set. Add it to your .env file.');
  process.exit(1);
}

const TEE_PRIVATE_KEY = process.env.TEE_PRIVATE_KEY;
if (!TEE_PRIVATE_KEY) {
  console.error('[Error] TEE_PRIVATE_KEY not set. Add it to your .env file.');
  process.exit(1);
}
const TEE_WALLET = new ethers.Wallet(TEE_PRIVATE_KEY);
const TEE_ADDRESS = TEE_WALLET.address;

async function main() {
  console.log("============================================================");
  console.log("🖥️ COGNIVAULT TEE COMPUTE NETWORK CLIENT");
  console.log(`Mode: LIVE 0G COMPUTE`);
  console.log(`TEE Signer Address: ${TEE_ADDRESS}`);
  console.log("============================================================");

  if (!fs.existsSync(STATE_FILE)) {
    console.error(`[Error] state.json not found at ${STATE_FILE}`);
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  const deployments = loadDeployments();
  const lendingAddr = deployments?.contracts?.lendingPool?.address || state.pools.lending.address;
  const ammAddr = deployments?.contracts?.ammPool?.address || state.pools.amm.address;

  const lendingAPY = state.pools.lending.apy;
  const lendingRisk = state.pools.lending.risk;
  const ammAPY = state.pools.amm.apy;
  const ammRisk = state.pools.amm.risk;
  const maxRisk = state.max_risk_limit;

  let allocations = [];
  let targets = [lendingAddr, ammAddr];
  let signature = "";
  let messageHash = "";

  console.log("[*] Dispatching inference request to 0G Compute Network...");
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const userWallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const broker = await createZGComputeNetworkBroker(userWallet);

    let computeProvider = process.env.COMPUTE_PROVIDER;
    if (!computeProvider) {
      console.log("[*] COMPUTE_PROVIDER not set. Auto-discovering available providers...");
      const providerList = await broker.inference.getServiceProviderList();
      if (!providerList || providerList.length === 0) {
        throw new Error("No 0G Compute providers available");
      }
      computeProvider = providerList[0];
      console.log(`[✔] Auto-discovered Compute Provider: ${computeProvider}`);
    }

    console.log(`Connecting to Compute Provider: ${computeProvider}`);
    const { endpoint, model } = await broker.inference.getServiceMetadata(computeProvider);
    console.log(`Service Metadata: endpoint=${endpoint}, model=${model}`);

    const headers = await broker.inference.getRequestHeaders(computeProvider);

    const prompt = `Optimize portfolio allocations for the following pool yields:
Lending Pool APY: ${lendingAPY} bps
Lending Pool Risk: ${lendingRisk}
AMM Pool APY: ${ammAPY} bps
AMM Pool Risk: ${ammRisk}
Risk limit: ${maxRisk}
Provide output as raw JSON containing "lending_bps" and "amm_bps".`;

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    const answer = data.choices[0].message.content;
    console.log(`Raw Inference Output:\n${answer}`);

    const chatID = response.headers.get("ZG-Res-Key") || data.id;
    if (chatID) {
      console.log(`Verifying TEE signature via broker client (chatID: ${chatID})...`);
      const isValid = await broker.inference.processResponse(computeProvider, chatID);
      console.log(`[✔] TEE signature verification check: ${isValid ? "VALID" : "INVALID"}`);
      if (!isValid) {
        throw new Error("Response TEE signature verification failed!");
      }
    } else {
      console.warn("[Warning] No ZG-Res-Key response header found. Skipping TEE signature verification.");
    }

    const jsonMatch = answer.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse JSON allocations from model response.");
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const lendingBps = parseInt(parsed.lending_bps);
    const ammBps = parseInt(parsed.amm_bps);
    allocations = [lendingBps, ammBps];

    console.log(`[✔] Resolved allocations: Lending: ${lendingBps} bps, AMM: ${ammBps} bps`);

    console.log(`[*] Dispersing strategy payload to 0G DA...`);
    const preSignPayload = {
      allocations,
      targets,
      signature: '0x00',
      messageHash: ethers.ZeroHash
    };
    const daResult = await disperseToDA(preSignPayload);
    const daBlobHash = daResult.blobHash;
    const dataRoot = daResult.dataRoot;
    const daEpoch = daResult.epoch;
    const daQuorumId = daResult.quorumId;

    const encoded = AbiCoder.defaultAbiCoder().encode(
      ['uint256[]', 'address[]', 'bytes32', 'bytes32', 'uint256', 'uint256'],
      [allocations, targets, daBlobHash, dataRoot, daEpoch, daQuorumId]
    );
    messageHash = keccak256(encoded);
    signature = await TEE_WALLET.signMessage(getBytes(messageHash));

    const runRecord = {
      timestamp: Date.now(),
      allocations,
      targets,
      da_blob_hash: daBlobHash.replace('0x', ''),
      da_data_root: dataRoot.replace('0x', ''),
      da_epoch: daEpoch,
      da_quorum_id: daQuorumId,
      signature: signature.replace('0x', ''),
      message_hash: messageHash.replace('0x', '')
    };
    state.history.push(runRecord);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
    updateStateWithDA(daResult);
    console.log("[✔] Updated state.json with live strategy execution run.");

  } catch (e) {
    console.error(`[Error] 0G Compute Inference failed: ${e.message}`);
    process.exit(1);
  }
}

main();
