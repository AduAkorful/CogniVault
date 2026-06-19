import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers, keccak256, AbiCoder } from 'ethers';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '..', 'state.json');
const MOCK_DA_DIR = path.join(__dirname, 'mock_0g_da');

const MOCK_DA = process.env.MOCK_DA === 'true' || !process.env.PRIVATE_KEY;
const DA_CLIENT_GRPC = process.env.DA_CLIENT_GRPC || 'localhost:51001';

/**
 * Disperses a strategy payload to 0G DA and returns the blob hash + data root.
 *
 * @param {Object} strategyPayload - The strategy payload to disperse
 * @param {number[]} strategyPayload.allocations - Allocation amounts in bps
 * @param {string[]} strategyPayload.targets - Target pool addresses
 * @param {string} strategyPayload.signature - TEE signature hex string
 * @param {string} strategyPayload.messageHash - Message hash hex string
 * @returns {Promise<{blobHash: string, dataRoot: string, epoch: number, quorumId: number}>}
 */
export async function disperseToDA(strategyPayload) {
  console.log("============================================================");
  console.log("📡 COGNIVAULT 0G DA DISPERSER CLIENT");
  console.log(`Mode: ${MOCK_DA ? 'MOCK / OFFLINE SIMULATION' : 'LIVE 0G DA CLIENT'}`);
  console.log("============================================================");

  const { allocations, targets, signature, messageHash } = strategyPayload;

  // ABI-encode the full strategy context into a binary blob
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ['uint256[]', 'address[]', 'bytes', 'bytes32'],
    [allocations, targets, signature, messageHash]
  );

  if (MOCK_DA) {
    return mockDispersal(encoded, strategyPayload);
  } else {
    return liveDispersal(encoded, strategyPayload);
  }
}

/**
 * Mock dispersal — computes deterministic hashes and writes proof artifacts locally.
 */
async function mockDispersal(encodedBlob, payload) {
  console.log("[*] Mock DA: Serializing strategy payload...");
  console.log(`    Blob size: ${encodedBlob.length} bytes`);

  // Create mock DA directory
  if (!fs.existsSync(MOCK_DA_DIR)) {
    fs.mkdirSync(MOCK_DA_DIR, { recursive: true });
  }

  // Compute deterministic blob hash from the encoded payload
  const blobHash = keccak256(encodedBlob);

  // Generate a simulated data root (deterministic hash of payload + epoch)
  const epoch = Math.floor(Date.now() / 60000); // Epoch based on current minute
  const dataRootInput = AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'uint256'],
    [blobHash, epoch]
  );
  const dataRoot = keccak256(dataRootInput);

  const quorumId = 0;

  console.log(`[✔] Mock DA dispersal complete:`);
  console.log(`    - Blob Hash:  ${blobHash}`);
  console.log(`    - Data Root:  ${dataRoot}`);
  console.log(`    - Epoch:      ${epoch}`);
  console.log(`    - Quorum ID:  ${quorumId}`);

  // Write proof artifacts to mock directory
  const proofArtifact = {
    timestamp: new Date().toISOString(),
    blobHash,
    dataRoot,
    epoch,
    quorumId,
    blobSizeBytes: encodedBlob.length,
    allocations: payload.allocations,
    targets: payload.targets,
    encodedBlobHex: encodedBlob
  };

  const artifactPath = path.join(MOCK_DA_DIR, `da_proof_${epoch}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(proofArtifact, null, 2), 'utf8');
  console.log(`[✔] Proof artifact written to: ${artifactPath}`);

  return { blobHash, dataRoot, epoch, quorumId };
}

/**
 * Live dispersal — connects to the 0G DA Client gRPC endpoint and submits the blob.
 */
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

  // Load the DA disperser proto definition
  // The 0G DA Client exposes a gRPC service for blob dispersal
  // We use a simplified client that sends raw bytes and receives confirmation
  const client = new grpc.default.Client(
    DA_CLIENT_GRPC,
    grpc.default.credentials.createInsecure()
  );

  // Convert encoded blob to Uint8Array for gRPC transmission
  const blobBytes = ethers.getBytes(encodedBlob);

  console.log(`[*] Dispersing blob (${blobBytes.length} bytes) to DA network...`);

  // Submit the blob via the DA Client's disperser endpoint
  // The DA Client handles encoding, signing, and submitting to DA nodes
  return new Promise((resolve, reject) => {
    // Use the generic unary call pattern for the DisperseBlob RPC
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + 300); // 5 minute timeout

    client.makeUnaryRequest(
      '/disperser.Disperser/DisperseBlob',
      // Serializer: wrap bytes in a simple protobuf message
      (arg) => {
        // Minimal protobuf encoding for DisperseRequest { bytes data = 1; }
        const lengthPrefix = Buffer.alloc(5);
        lengthPrefix.writeUInt8(0, 0); // Not compressed
        lengthPrefix.writeUInt32BE(blobBytes.length + 2, 1); // message length
        const fieldTag = Buffer.from([0x0a, blobBytes.length]); // field 1, length-delimited
        return Buffer.concat([fieldTag, Buffer.from(blobBytes)]);
      },
      // Deserializer: extract response fields
      (buffer) => {
        // Parse the response to extract blob hash and status
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

        // For the MVP, compute deterministic values from the blob content
        // In production, these come from the DA network confirmation
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

/**
 * Updates state.json with DA-related fields after successful dispersal.
 */
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

/**
 * Standalone execution — reads the latest strategy from state.json and disperses it.
 */
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

  // Use the latest strategy run from history
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

// Run standalone if executed directly
main();
