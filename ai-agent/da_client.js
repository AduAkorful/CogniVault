import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers, keccak256, AbiCoder } from 'ethers';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const STATE_FILE = path.join(__dirname, '..', 'state.json');
const PROTO_PATH = path.join(__dirname, 'proto', 'disperser.proto');
const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const DA_CLIENT_GRPC = process.env.DA_CLIENT_GRPC || 'localhost:51001';
const DA_POLL_INTERVAL_MS = parseInt(process.env.DA_POLL_INTERVAL_MS || '3000', 10);
const DA_POLL_MAX_ATTEMPTS = parseInt(process.env.DA_POLL_MAX_ATTEMPTS || '100', 10);
const DA_DEMO_MODE = process.env.DA_DEMO_MODE === 'true' || process.env.DA_DEMO_MODE === '1';
const DA_SIGNERS = '0x0000000000000000000000000000000000001000';

const BLOB_CONFIRMED = 2;
const BLOB_FINALIZED = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToHex32(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  return `0x${hex.padStart(64, '0').slice(-64)}`;
}

async function fetchDaEpoch() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const daSigners = new ethers.Contract(
      DA_SIGNERS,
      ['function epochNumber() view returns (uint256)'],
      provider
    );
    return Number(await daSigners.epochNumber());
  } catch {
    return Math.floor(Date.now() / 60000);
  }
}

function demoDispersal(blobHash, epoch, quorumId = 0) {
  const dataRootInput = AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'uint256', 'uint256'],
    [blobHash, epoch, quorumId]
  );
  const dataRoot = keccak256(dataRootInput);
  return { blobHash, dataRoot, epoch, quorumId, demo: true };
}

async function loadDisperserClient() {
  const grpc = await import('@grpc/grpc-js');
  const protoLoader = await import('@grpc/proto-loader');

  const packageDefinition = protoLoader.default.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.default.loadPackageDefinition(packageDefinition).disperser;
  const client = new proto.Disperser(DA_CLIENT_GRPC, grpc.default.credentials.createInsecure());
  return client;
}

async function liveDispersal(blobBytes, blobHash) {
  const client = await loadDisperserClient();

  console.log(`[*] Dispersing blob (${blobBytes.length} bytes)...`);
  const disperseReply = await new Promise((resolve, reject) => {
    client.DisperseBlob({ data: Buffer.from(blobBytes) }, (err, reply) => {
      if (err) reject(err);
      else resolve(reply);
    });
  });

  const requestId = disperseReply.request_id;
  if (!requestId || requestId.length === 0) {
    throw new Error('Disperser returned empty request_id');
  }
  console.log(`[✔] Blob accepted. request_id=${Buffer.from(requestId).toString('hex').slice(0, 16)}...`);

  for (let attempt = 1; attempt <= DA_POLL_MAX_ATTEMPTS; attempt++) {
    const statusReply = await new Promise((resolve, reject) => {
      client.GetBlobStatus({ request_id: requestId }, (err, reply) => {
        if (err) reject(err);
        else resolve(reply);
      });
    });

    const status = Number(statusReply.status);
    console.log(`[*] Poll ${attempt}/${DA_POLL_MAX_ATTEMPTS}: status=${statusReply.status}`);

    if (status === BLOB_CONFIRMED || status === BLOB_FINALIZED) {
      const header = statusReply.info?.blob_header;
      if (!header?.storage_root) {
        throw new Error('CONFIRMED blob missing storage_root in BlobHeader');
      }

      const dataRoot = bytesToHex32(header.storage_root);
      const epoch = Number(header.epoch);
      const quorumId = Number(header.quorum_id);

      console.log('[✔] DA dispersal confirmed:');
      console.log(`    - Blob Hash:  ${blobHash}`);
      console.log(`    - Data Root:  ${dataRoot}`);
      console.log(`    - Epoch:      ${epoch}`);
      console.log(`    - Quorum ID:  ${quorumId}`);

      return { blobHash, dataRoot, epoch, quorumId, requestId: Buffer.from(requestId).toString('hex') };
    }

    if (status === 3 || status === 5) {
      throw new Error(`DA dispersal failed with terminal status ${status}`);
    }

    await sleep(DA_POLL_INTERVAL_MS);
  }

  throw new Error(`DA dispersal timed out after ${DA_POLL_MAX_ATTEMPTS} polls`);
}

export async function disperseToDA(strategyPayload) {
  console.log('============================================================');
  console.log('📡 COGNIVAULT 0G DA DISPERSER CLIENT');
  console.log(`Mode: ${DA_DEMO_MODE ? 'DA DEMO (CogniDAVerifier attestation)' : 'LIVE gRPC'}`);
  if (!DA_DEMO_MODE) console.log(`gRPC endpoint: ${DA_CLIENT_GRPC}`);
  console.log('============================================================');

  const { allocations, targets, signature, messageHash } = strategyPayload;

  const encoded = AbiCoder.defaultAbiCoder().encode(
    ['uint256[]', 'address[]', 'bytes', 'bytes32'],
    [allocations, targets, signature, messageHash]
  );

  const blobBytes = ethers.getBytes(encoded);
  const blobHash = keccak256(encoded);

  if (DA_DEMO_MODE) {
    const epoch = await fetchDaEpoch();
    const result = demoDispersal(blobHash, epoch, 0);
    console.log('[✔] Demo DA commitment generated (no external disperser required):');
    console.log(`    - Blob Hash:  ${result.blobHash}`);
    console.log(`    - Data Root:  ${result.dataRoot}`);
    console.log(`    - Epoch:      ${result.epoch} (from DASigners precompile)`);
    console.log(`    - Quorum ID:  ${result.quorumId}`);
    console.log('[i] Relayer will register this commitment on CogniDAVerifier before execution.');
    return result;
  }

  try {
    return await liveDispersal(blobBytes, blobHash);
  } catch (err) {
    console.error(`[Error] Live DA dispersal failed: ${err.message}`);
    throw err;
  }
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
  state.da_demo_mode = !!daResult.demo;

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), 'utf8');
  console.log('[✔] Updated state.json with DA fields.');
}

async function main() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error(`[Error] state.json not found at ${STATE_FILE}`);
    console.error('Run compute_client.js first to generate a strategy.');
    process.exit(1);
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  if (!state.history || state.history.length === 0) {
    console.error('[Error] No strategy history found in state.json.');
    console.error('Run compute_client.js first to generate a strategy.');
    process.exit(1);
  }

  const latestRun = state.history[state.history.length - 1];

  const strategyPayload = {
    allocations: latestRun.allocations,
    targets: latestRun.targets,
    signature: `0x${latestRun.signature}`,
    messageHash: `0x${latestRun.message_hash}`,
  };

  console.log(`[*] Dispersing strategy from run #${state.history.length}...`);
  console.log(`    Allocations: [${latestRun.allocations.join(', ')}]`);
  console.log(`    Targets: [${latestRun.targets.join(', ')}]`);

  try {
    const result = await disperseToDA(strategyPayload);
    updateStateWithDA(result);
    console.log('\n[✔] DA dispersal pipeline complete.');
  } catch (e) {
    console.error(`\n[Error] DA dispersal failed: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
