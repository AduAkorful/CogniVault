import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEPLOYMENTS_FILE = path.join(__dirname, '..', 'deployments.json');
const BASE_INTERVAL_MS = parseInt(process.env.MARKET_SIM_INTERVAL_MS || '300000', 10); // 5 min base
const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const POOL_ABI = [
  "function setAPY(uint256) external",
  "function getAPY() view returns (uint256)",
  "function owner() view returns (address)"
];

// Realistic APY ranges (in basis points)
const RANGES = {
  lending: { min: 200, max: 1500, mid: 850 },   // 2% - 15%
  amm:     { min: 500, max: 3000, mid: 1750 }    // 5% - 30%
};

// Market regimes — each produces different movement characteristics
// The regime shifts randomly, so the bot doesn't loop through predictable patterns
const REGIMES = [
  { name: 'stable',    weight: 30, drift: 0.03, eventChance: 0.05, eventSize: 0.15 },
  { name: 'trending',  weight: 25, drift: 0.08, eventChance: 0.10, eventSize: 0.25 },
  { name: 'volatile',  weight: 20, drift: 0.15, eventChance: 0.25, eventSize: 0.40 },
  { name: 'crash',     weight: 10, drift: 0.12, eventChance: 0.40, eventSize: 0.50, bias: -1 },
  { name: 'recovery',  weight: 15, drift: 0.10, eventChance: 0.30, eventSize: 0.35, bias: 1 },
];

let currentRegime = pickRegime();
let regimeCyclesLeft = randInt(3, 8); // each regime lasts 3-8 cycles

// Crypto-secure random [0, 1)
function cryptoRandom() {
  const buf = crypto.randomBytes(4);
  return buf.readUInt32BE() / 0x100000000;
}

// Crypto-secure random int [min, max] inclusive
function randInt(min, max) {
  return min + Math.floor(cryptoRandom() * (max - min + 1));
}

// Weighted regime selection
function pickRegime() {
  const totalWeight = REGIMES.reduce((s, r) => s + r.weight, 0);
  let roll = cryptoRandom() * totalWeight;
  for (const regime of REGIMES) {
    roll -= regime.weight;
    if (roll <= 0) return regime;
  }
  return REGIMES[0];
}

// Mean-reverting random walk with regime-driven events
function generateAPY(pool, currentAPY) {
  const range = RANGES[pool];
  const regime = currentRegime;
  const isEvent = cryptoRandom() < regime.eventChance;

  let newAPY;
  let eventLabel = '';

  if (isEvent) {
    // Market event: large jump in biased direction
    const jumpFraction = regime.eventSize * (0.5 + cryptoRandom() * 0.5);
    const jumpSize = Math.floor((range.max - range.min) * jumpFraction);
    let direction;
    if (regime.bias !== undefined) {
      // Biased regime (crash = down, recovery = up) — 80% biased, 20% opposite
      direction = cryptoRandom() < 0.8 ? regime.bias : -regime.bias;
    } else {
      direction = cryptoRandom() < 0.5 ? -1 : 1;
    }
    newAPY = currentAPY + (direction * jumpSize);
    eventLabel = `[${direction > 0 ? 'SPIKE' : 'DROP'} ${regime.name}]`;
  } else {
    // Normal drift — mean-reverting random walk
    // Pull toward midpoint (prevents getting stuck at edges)
    const distanceFromMid = range.mid - currentAPY;
    const meanReversion = distanceFromMid * 0.15; // 15% pull toward center
    const noise = (cryptoRandom() - 0.5) * 2 * range.mid * regime.drift;
    newAPY = currentAPY + meanReversion + noise;
    eventLabel = `[${regime.name}]`;
  }

  // Clamp to range
  newAPY = Math.max(range.min, Math.min(range.max, Math.round(newAPY)));

  // 5% chance of full re-seed to a completely random position (breaks any cycle)
  if (cryptoRandom() < 0.05) {
    newAPY = randInt(range.min, range.max);
    eventLabel = `[RESHUFFLE ${regime.name}]`;
  }

  return { apy: newAPY, event: eventLabel };
}

// Jittered interval — varies ±40% so the rhythm isn't perfectly predictable
function getNextInterval() {
  const jitter = (cryptoRandom() - 0.5) * 0.8; // ±40%
  return Math.max(60000, Math.floor(BASE_INTERVAL_MS * (1 + jitter)));
}

function loadDeployments() {
  if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    throw new Error('deployments.json not found. Run the deployment script first.');
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf8'));
}

async function runCycle(deployments, wallet) {
  const lendingPoolAddr = deployments.contracts.lendingPool.address;
  const ammPoolAddr = deployments.contracts.ammPool.address;

  if (!lendingPoolAddr || !ammPoolAddr) {
    console.error('[Market Sim] Pool addresses not found in deployments.json');
    return;
  }

  const lendingPool = new ethers.Contract(lendingPoolAddr, POOL_ABI, wallet);
  const ammPool = new ethers.Contract(ammPoolAddr, POOL_ABI, wallet);

  // Verify wallet is the owner
  const lendingOwner = await lendingPool.owner();
  if (lendingOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`[Market Sim] Wallet ${wallet.address} is not the pool owner.`);
    return;
  }

  // Regime management
  regimeCyclesLeft--;
  if (regimeCyclesLeft <= 0) {
    const oldRegime = currentRegime.name;
    currentRegime = pickRegime();
    regimeCyclesLeft = randInt(3, 8);
    console.log(`\n[Market Sim] Regime shifted: ${oldRegime} → ${currentRegime.name} (next ${regimeCyclesLeft} cycles)`);
  }

  // Get current APYs
  const currentLendingAPY = Number(await lendingPool.getAPY());
  const currentAmmAPY = Number(await ammPool.getAPY());

  // Generate new APYs (each pool gets independent randomization)
  const lendingResult = generateAPY('lending', currentLendingAPY);
  const ammResult = generateAPY('amm', currentAmmAPY);

  console.log('\n============================================================');
  console.log(`📊 MARKET SIMULATION — ${new Date().toISOString()}`);
  console.log(`   Regime: ${currentRegime.name} (${regimeCyclesLeft} cycles left)`);
  console.log('============================================================');

  if (lendingResult.apy !== currentLendingAPY) {
    const change = ((lendingResult.apy - currentLendingAPY) / 100).toFixed(2);
    console.log(`  Lending: ${(currentLendingAPY / 100).toFixed(2)}% → ${(lendingResult.apy / 100).toFixed(2)}% (${change > 0 ? '+' : ''}${change}%) ${lendingResult.event}`);
    const tx = await lendingPool.setAPY(lendingResult.apy);
    await tx.wait();
    console.log(`  ✔ Tx: ${tx.hash}`);
  }

  if (ammResult.apy !== currentAmmAPY) {
    const change = ((ammResult.apy - currentAmmAPY) / 100).toFixed(2);
    console.log(`  AMM:     ${(currentAmmAPY / 100).toFixed(2)}% → ${(ammResult.apy / 100).toFixed(2)}% (${change > 0 ? '+' : ''}${change}%) ${ammResult.event}`);
    const tx = await ammPool.setAPY(ammResult.apy);
    await tx.wait();
    console.log(`  ✔ Tx: ${tx.hash}`);
  }

  console.log('============================================================\n');
}

async function main() {
  console.log('============================================================');
  console.log('🎲 COGNIVAULT MARKET SIMULATION BOT');
  console.log(`  Base interval: ${BASE_INTERVAL_MS / 1000}s (jittered ±40%)`);
  console.log(`  Randomization: crypto-secure (node:crypto)`);
  console.log(`  Regimes: ${REGIMES.map(r => r.name).join(', ')}`);
  console.log(`  RPC: ${RPC_URL}`);
  console.log('============================================================');

  if (!PRIVATE_KEY) {
    console.error('[Error] PRIVATE_KEY is required. Set it in your .env file.');
    process.exit(1);
  }

  const deployments = loadDeployments();
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`  Wallet: ${wallet.address}`);
  console.log(`  Lending Pool: ${deployments.contracts.lendingPool.address || 'NOT SET'}`);
  console.log(`  AMM Pool: ${deployments.contracts.ammPool.address || 'NOT SET'}`);
  console.log(`  Starting regime: ${currentRegime.name}`);
  console.log('============================================================\n');

  // First cycle immediately
  await runCycle(deployments, wallet);

  // Schedule next cycle with jittered interval
  function scheduleNext() {
    const delay = getNextInterval();
    setTimeout(async () => {
      try {
        await runCycle(deployments, wallet);
      } catch (err) {
        console.error('[Market Sim] Cycle failed:', err.message);
      }
      scheduleNext();
    }, delay);
  }
  scheduleNext();
}

main().catch(console.error);
