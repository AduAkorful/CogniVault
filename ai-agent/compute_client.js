import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers, keccak256, getBytes, AbiCoder } from 'ethers';
import { createZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk';
import { disperseToDA, updateStateWithDA } from './da_client.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '..', 'state.json');

const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const COMPUTE_PROVIDER = process.env.COMPUTE_PROVIDER || '0x0000000000000000000000000000000000000000';
const MOCK_COMPUTE = process.env.MOCK_COMPUTE === 'true' || !PRIVATE_KEY;

// Default simulated TEE credentials
const TEE_PRIVATE_KEY = "0x5de4111afa73d9b5c2c6b3e407d36fd5d2f47055c1798317e0892c2cf80ed3d1";
const TEE_WALLET = new ethers.Wallet(TEE_PRIVATE_KEY);
const TEE_ADDRESS = TEE_WALLET.address;

async function main() {
  console.log("============================================================");
  console.log("🖥️ COGNIVAULT TEE COMPUTE NETWORK CLIENT");
  console.log(`Mode: ${MOCK_COMPUTE ? 'MOCK / OFFLINE TEE SIMULATION' : 'LIVE 0G COMPUTE'}`);
  console.log(`TEE Signer Address: ${TEE_ADDRESS}`);
  console.log("============================================================");

  if (!fs.existsSync(STATE_FILE)) {
    console.error(`[Error] state.json not found at ${STATE_FILE}`);
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  const lendingAPY = state.pools.lending.apy;
  const lendingRisk = state.pools.lending.risk;
  const ammAPY = state.pools.amm.apy;
  const ammRisk = state.pools.amm.risk;
  const maxRisk = state.max_risk_limit;

  let allocations = [];
  let targets = [state.pools.lending.address, state.pools.amm.address];
  let signature = "";
  let messageHash = "";

  if (MOCK_COMPUTE) {
    console.log("[*] Computing optimal portfolio splits off-chain...");
    
    // Analytical LP Optimization logic: Maximize APY subject to risk limit
    let allocLending = 0;
    let allocAmm = 0;

    if (ammAPY > lendingAPY) {
      if (ammRisk <= lendingRisk) {
        allocAmm = 1.0;
      } else {
        allocAmm = (maxRisk - lendingRisk) / (ammRisk - lendingRisk);
        allocAmm = Math.max(0.0, Math.min(1.0, allocAmm));
      }
      allocLending = 1.0 - allocAmm;
    } else {
      if (lendingRisk <= ammRisk) {
        allocLending = 1.0;
      } else {
        allocLending = (maxRisk - ammRisk) / (lendingRisk - ammRisk);
        allocLending = Math.max(0.0, Math.min(1.0, allocLending));
      }
      allocAmm = 1.0 - allocLending;
    }

    const lendingBps = Math.round(allocLending * 10000);
    const ammBps = 10000 - lendingBps;
    allocations = [lendingBps, ammBps];

    console.log(`[✔] Resolved allocations in secure enclave:`);
    console.log(`    - Lending Pool: ${(lendingBps / 100).toFixed(2)}% (${lendingBps} bps)`);
    console.log(`    - AMM Pool: ${(ammBps / 100).toFixed(2)}% (${ammBps} bps)`);

    // Disperse strategy payload to 0G DA to get real blobHash + dataRoot
    console.log(`[*] Dispersing strategy payload to 0G DA...`);
    const preSignPayload = {
      allocations,
      targets,
      signature: '0x00', // Placeholder — will be replaced after signing
      messageHash: ethers.ZeroHash
    };
    const daResult = await disperseToDA(preSignPayload);
    const daBlobHash = daResult.blobHash;
    const dataRoot = daResult.dataRoot;

    console.log(`[*] Generating TEE cryptographic signature (including dataRoot)...`);
    const encoded = AbiCoder.defaultAbiCoder().encode(
      ['uint256[]', 'address[]', 'bytes32', 'bytes32'],
      [allocations, targets, daBlobHash, dataRoot]
    );
    
    messageHash = keccak256(encoded);
    signature = await TEE_WALLET.signMessage(getBytes(messageHash));
    
    console.log(`[✔] TEE signature generated successfully: ${signature}`);

    // Update state.json history
    const runRecord = {
      timestamp: Date.now(),
      allocations,
      targets,
      da_blob_hash: daBlobHash.replace('0x', ''),
      da_data_root: dataRoot.replace('0x', ''),
      da_epoch: daResult.epoch,
      da_quorum_id: daResult.quorumId,
      signature: signature.replace('0x', ''),
      message_hash: messageHash.replace('0x', '')
    };
    state.history.push(runRecord);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
    updateStateWithDA(daResult);
    console.log("[✔] Updated state.json with new strategy execution run.");

  } else {
    console.log("[*] Dispatching inference request to 0G Compute Network...");
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const userWallet = new ethers.Wallet(PRIVATE_KEY, provider);
      const broker = await createZGComputeNetworkBroker(userWallet);

      console.log(`Connecting to Compute Provider: ${COMPUTE_PROVIDER}`);
      const { endpoint, model } = await broker.inference.getServiceMetadata(COMPUTE_PROVIDER);
      console.log(`Service Metadata: endpoint=${endpoint}, model=${model}`);

      const headers = await broker.inference.getRequestHeaders(COMPUTE_PROVIDER);
      
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

      // Verify response TEE signature
      const chatID = response.headers.get("ZG-Res-Key") || data.id;
      if (chatID) {
        console.log(`Verifying TEE signature via broker client (chatID: ${chatID})...`);
        const isValid = await broker.inference.processResponse(COMPUTE_PROVIDER, chatID);
        console.log(`[✔] TEE signature verification check: ${isValid ? "VALID" : "INVALID"}`);
        if (!isValid) {
          throw new Error("Response TEE signature verification failed!");
        }
      } else {
        console.warn("[Warning] No ZG-Res-Key response header found. Skipping TEE signature verification.");
      }

      // Parse JSON from answer
      const jsonMatch = answer.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        throw new Error("Failed to parse JSON allocations from model response.");
      }
      const parsed = JSON.parse(jsonMatch[0]);
      const lendingBps = parseInt(parsed.lending_bps);
      const ammBps = parseInt(parsed.amm_bps);
      allocations = [lendingBps, ammBps];

      console.log(`[✔] Resolved allocations: Lending: ${lendingBps} bps, AMM: ${ammBps} bps`);

      // Disperse strategy payload to 0G DA
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

      // Construct transaction hash and TEE-sign it (including dataRoot)
      const encoded = AbiCoder.defaultAbiCoder().encode(
        ['uint256[]', 'address[]', 'bytes32', 'bytes32'],
        [allocations, targets, daBlobHash, dataRoot]
      );
      messageHash = keccak256(encoded);
      signature = await TEE_WALLET.signMessage(getBytes(messageHash));

      // Update state.json history
      const runRecord = {
        timestamp: Date.now(),
        allocations,
        targets,
        da_blob_hash: daBlobHash.replace('0x', ''),
        da_data_root: dataRoot.replace('0x', ''),
        da_epoch: daResult.epoch,
        da_quorum_id: daResult.quorumId,
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
}

main();
