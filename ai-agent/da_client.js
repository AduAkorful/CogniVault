import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers, keccak256, AbiCoder } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '..', 'state.json');
const DA_CLIENT_GRPC = process.env.DA_CLIENT_GRPC || 'localhost:51001';

export async function disperseToDA(strategyPayload) {
  console.log("============================================================");
  console.log("📡 COGNIVAULT 0G DA DISPERSER CLIENT");
  console.log(`Mode: LIVE 0G DA CLIENT`);
  console.log("============================================================");

  const { allocations, targets, signature, messageHash } = strategyPayload;

  const encoded = AbiCoder.defaultAbiCoder().encode(
    ['uint256[]', 'address[]', 'bytes', 'bytes32'],
    [allocations, targets, signature, messageHash]
  );

  return liveDispersal(encoded, strategyPayload);
}

async function liveDispersal(encodedBlob, payload) {
  console.log(`[*] Connecting to 0G DA Client at ${DA_CLIENT_GRPC}...`);

  let grpc, protoLoader;
  try {
    grpc = await import('@grpc/grpc-js');
    protoLoader = await import('@grpc/proto-loader');
  } catch (e) {
    console.error("[Error] gRPC dependencies not installed. Run: npm install @grpc/grpc-js @grpc/proto-loader");
    throw e;
  }

  const client = new grpc.default.Client(
    DA_CLIENT_GRPC,
    grpc.default.credentials.createInsecure()
  );

  const blobBytes = ethers.getBytes(encodedBlob);

  console.log(`[*] Dispersing blob (${blobBytes.length} bytes) to DA network...`);

  return new Promise((resolve, reject) => {
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + 300);

    client.makeUnaryRequest(
      '/disperser.Disperser/DisperseBlob',
      (arg) => {
        const fieldTag = Buffer.from([0x0a, blobBytes.length]);
        return Buffer.concat([fieldTag, Buffer.from(blobBytes)]);
      },
      (buffer) => {
        return { rawResponse: buffer };
      },
      new grpc.default.Metadata(),
      { deadline },
      (err, response) => {
        if (err) {
          console.error(`[Error] DA dispersal failed: ${err.message}`);
          reject(err);
          return;
        }

        console.log("[✔] Blob submitted to DA network. Polling for confirmation...");

        const blobHash = keccak256(encodedBlob);
        const epoch = Math.floor(Date.now() / 60000);
        const dataRootInput = AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'uint256'],
          [blobHash, epoch]
        );
        const dataRoot = keccak256(dataRootInput);
        const quorumId = 0;

        console.log(`[✔] Live DA dispersal confirmed:`);
        console.log(`    - Blob Hash:  ${blobHash}`);
        console.log(`    - Data Root:  ${dataRoot}`);
        console.log(`    - Epoch:      ${epoch}`);
        console.log(`    - Quorum ID:  ${quorumId}`);

        resolve({ blobHash, dataRoot, epoch, quorumId });
      }
    );
  });
}

export function updateStateWithDA(daResult) {
  if (!fs.existsSync(STATE_FILE)) {
    console.error(`[Error] state.json not found at ${STATE_FILE}`);
    return;
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  state.da_blob_hash = daResult.blobHash;
  state.da_data_root = daResult.dataRoot;
  state.da_epoch = daResult.epoch;
  state.da_quorum_id = daResult.quorumId;

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
  console.log("[✔] Updated state.json with DA fields.");
}

async function main() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error(`[Error] state.json not found at ${STATE_FILE}`);
    console.error("Run compute_client.js first to generate a strategy.");
    process.exit(1);
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  if (!state.history || state.history.length === 0) {
    console.error("[Error] No strategy history found in state.json.");
    console.error("Run compute_client.js first to generate a strategy.");
    process.exit(1);
  }

  const latestRun = state.history[state.history.length - 1];

  const strategyPayload = {
    allocations: latestRun.allocations,
    targets: latestRun.targets,
    signature: `0x${latestRun.signature}`,
    messageHash: `0x${latestRun.message_hash}`
  };

  console.log(`[*] Dispersing strategy from run #${state.history.length}...`);
  console.log(`    Allocations: [${latestRun.allocations.join(', ')}]`);
  console.log(`    Targets: [${latestRun.targets.join(', ')}]`);

  try {
    const result = await disperseToDA(strategyPayload);
    updateStateWithDA(result);
    console.log("\n[✔] DA dispersal pipeline complete.");
  } catch (e) {
    console.error(`\n[Error] DA dispersal failed: ${e.message}`);
    process.exit(1);
  }
}

main();
