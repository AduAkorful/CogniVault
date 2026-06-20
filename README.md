# CogniVault

**AI-Governed ERC-4626 Yield Optimizer on the 0G Modular Stack**

CogniVault is an autonomous yield optimization vault that uses AI to rebalance
deposits across DeFi pools. Strategy computation runs off-chain inside a
verifiable TEE (0G Compute), historical market data is stored on 0G Storage,
and rebalance payloads are committed via 0G Data Availability — all verified
on-chain before execution.

Users simply deposit USDC. The AI agent continuously monitors pool APYs,
computes optimal risk-bounded allocations, signs the strategy inside a TEE,
disperses the payload to 0G DA, and the relayer executes it on-chain. No
manual intervention required.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER (Browser)                           │
│  Connect wallet → Deposit USDC → Watch AI grow position          │
└──────────────┬──────────────────────────────────┬───────────────┘
               │                                  │
               ▼                                  ▼
┌──────────────────────┐            ┌───────────────────────────┐
│  Vercel (Frontend)   │            │  Render (AI Agent Backend) │
│  React + Reown AppKit │            │  Docker: Node + Python     │
│  Reads vault data via │            │                            │
│  0G RPC (read-only)   │  fetch     │  market_simulator.js       │
│  Fetches pipeline     │◄──────────►│    → random APY updates    │
│  telemetry from API   │  state.json│  relayer.js                │
└──────────┬───────────┘            │    → Sense→Think→Publish    │
           │                         │  api_server.js             │
           │                         │    → serves /state.json     │
           ▼                         └───────────┬─────────────────┘
           │                                     │
           ▼                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   0G Galileo Testnet (Chain ID 16602)            │
│                                                                  │
│  AIGovernedVault (UUPS Proxy)                                    │
│    ├─ verify TEE signature (ECDSA)                               │
│    ├─ verify DA blob (0G DA Entrance)                            │
│    ├─ check slippage (PriceOracle)                               │
│    └─ reallocate funds across whitelisted pools                  │
│                                                                  │
│  LendingPool / AMMPool (yield-bearing, APY adjustable)           │
│  USDC (6-decimal base asset)                                     │
│  PriceOracle (token price feed for slippage checks)              │
└─────────────────────────────────────────────────────────────────┘
```

### The Autonomous Loop

1. **Market Simulation Bot** — Randomly updates pool APYs on-chain every ~5
   minutes using crypto-secure entropy and market regimes (stable, trending,
   volatile, crash, recovery). Simulates real DeFi market movements.

2. **0G Storage** — `log_aggregator.js` snapshots current pool metrics
   (APYs, TVL, risk) and uploads them to 0G Storage as a Merkle-rooted
   `ZgFile`. The AI agent downloads and verifies these via Merkle
   inclusion proofs.

3. **0G Compute** — `compute_client.js` dispatches the portfolio optimization
   to a 0G Compute provider running inside a TEE. The model computes
   risk-bounded optimal allocations (maximize yield subject to a risk limit)
   and signs the result with the TEE's ECDSA key.

4. **0G DA** — `da_client.js` disperses the signed strategy payload
   (allocations + targets + signature) to the 0G DA network, retrieving a
   `blobHash` and `dataRoot` as cryptographic availability proof.

5. **On-chain Execution** — `relayer.js` calls `executeAIStrategy()` on the
   vault. The contract verifies the TEE signature, checks DA blob
   confirmation via the real 0G DA Entrance contract, validates slippage
   against the oracle, withdraws from current pools, and deposits into the
   new optimal allocation.

---

## Architecture

### Smart Contracts (`/contracts`)

| Contract | Type | Description |
| :--- | :--- | :--- |
| `AIGovernedVault.sol` | UUPS Upgradeable | ERC-4626 vault with TEE signature verification, DA proof checks, slippage protection, and AI strategy execution |
| `LendingPool.sol` | Regular | Yield pool with block-by-block interest accrual and owner-adjustable APY |
| `AMMPool.sol` | Regular | Same as LendingPool — simulates AMM trading fee yield |
| `USDC.sol` | Regular | 6-decimal ERC20 base asset with minter controls |
| `W0G.sol` | Regular | 18-decimal wrapped native token |
| `PriceOracle.sol` | Regular | Chainlink-compatible price feed for slippage checks |

**Upgradeability:** The vault uses the UUPS proxy pattern. The proxy address
is stable across upgrades — only the implementation changes. The upgrade is
gated by `onlyOwner` via `_authorizeUpgrade()`.

**0G DA Integration:** The vault verifies data root confirmation via the real
0G DA Entrance contract at `0x857C0A28A8634614BB2C96039Cf4a20AFF709Aa9`.

### AI Agent (`/ai-agent`)

| File | Role |
| :--- | :--- |
| `market_simulator.js` | Autonomous bot — randomly updates pool APYs every ~5 min using crypto-secure entropy and market regimes |
| `log_aggregator.js` | Snapshots pool metrics → uploads to 0G Storage as Merkle-rooted ZgFile |
| `compute_client.js` | Dispatches optimization to 0G Compute TEE, auto-discovers providers, signs result, disperses to 0G DA |
| `da_client.js` | 0G DA disperser client (gRPC to 0G DA network) |
| `relayer.js` | Orchestrates the full pipeline and calls `executeAIStrategy()` on-chain |
| `api_server.js` | HTTP server serving `/state.json` and `/deployments.json` with CORS |
| `simulator.py` | Python strategy optimizer (LP formulation, risk-bounded) |
| `storage_client.py` | 0G Storage download client with Merkle verification |

### Frontend (`/frontend`)

| File | Role |
| :--- | :--- |
| `src/App.jsx` | Single-page dashboard — protocol metrics always visible, user position on connect |
| `src/config/wallet.js` | Reown AppKit config with custom 0G Galileo network |
| `src/config/contracts.js` | Contract ABIs + chain constants (addresses read from `deployments.json`) |
| `src/hooks/useVault.js` | Ethers.js hooks for deposit, withdraw, executeAIStrategy, vault state reads |

---

## Deployed Contracts

All addresses are in **`deployments.json`** (repo root) — the single source
of truth. The deployment script writes to it automatically.

| Contract | Address |
| :--- | :--- |
| **AIGovernedVault (Proxy)** | `0x707531c9999AaeF9232C8FEfBA31FBa4cB78d84a` |
| **AIGovernedVault (Impl)** | `0xB9d9e972100a1dD01cd441774b45b5821e136043` |
| **USDC** | `0x90c84237fDdf091b1E63f369AF122EB46000bc70` |
| **W0G** | `0x3D63c50AD04DD5aE394CAB562b7691DD5de7CF6f` |
| **LendingPool** | `0x103A3b128991781EE2c8db0454cA99d67b257923` |
| **AMMPool** | `0xBbc18b580256A82dC0F9A86152b8B22E7C1C8005` |
| **PriceOracle** | `0xF66CfDf074D2FFD6A4037be3A669Ed04380Aef2B` |
| **0G DA Entrance** | `0x857C0A28A8634614BB2C96039Cf4a20AFF709Aa9` |

**Network:** 0G-Galileo-Testnet · Chain ID `16602` · RPC `https://evmrpc-testnet.0g.ai`
· Explorer [chainscan-galileo.0g.ai](https://chainscan-galileo.0g.ai)

**TEE Signer:** `0x78D1d675952c2d202D2d899ba3C1498C44cd3971`

---

## Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast)
- [Node.js](https://nodejs.org/) 20+
- [Python](https://www.python.org/) 3.10+ with pip
- [MetaMask](https://metamask.io/) or any Web3 wallet

### 1. Smart Contracts

```bash
cd contracts
forge install                    # install git submodules (OZ, forge-std)
npm install                      # install @openzeppelin/foundry-upgrades
forge build                      # compile
forge test                       # run 57 tests (all must pass)
```

### 2. Deploy

```bash
# Set environment variables
export PRIVATE_KEY="0x..."        # your deployer wallet
export TEE_SIGNER="0x78D1d675952c2d202D2d899ba3C1498C44cd3971"

# Deploy to Galileo Testnet
forge script script/DeployCogniVault.s.sol \
  --rpc-url https://evmrpc-testnet.0g.ai \
  --broadcast --legacy --gas-limit 10000000

# deployments.json is written with all addresses
```

### 3. Upgrade (Future)

The vault is UUPS upgradeable. The proxy address never changes.

```bash
# After modifying AIGovernedVault.sol:
forge script script/UpgradeVault.s.sol \
  --rpc-url https://evmrpc-testnet.0g.ai \
  --broadcast --legacy --gas-limit 10000000

# deployments.json implementation address is updated automatically
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev          # local dev at http://localhost:5173
npm run build        # production build to dist/
```

**Environment variables** (`.env.local` or Vercel dashboard):

| Variable | Required | Description |
| :--- | :--- | :--- |
| `VITE_REOWN_PROJECT_ID` | Yes | Reown AppKit project ID from [dashboard.reown.com](https://dashboard.reown.com) |
| `VITE_PIPELINE_API_URL` | No | URL of the AI agent backend. If unset, uses bundled `state.json` |

### 5. AI Agent Backend

```bash
cd ai-agent
npm install
pip3 install web3 eth-account eth-abi

# Set required environment variables
export PRIVATE_KEY="0x..."           # deployer/pool owner key
export TEE_PRIVATE_KEY="0x..."       # TEE signing key
export RPC_URL="https://evmrpc-testnet.0g.ai"

# Run the full pipeline:
node relayer.js                       # autonomous relayer loop

# API server (serves state.json + deployments.json):
node api_server.js

# Market simulation bot (requires owner PRIVATE_KEY):
node market_simulator.js

# 0G Compute client (auto-discovers providers):
node compute_client.js
```

---

## Deployment (Vercel + Render)

### Frontend → Vercel

1. Push to GitHub
2. Import repo on [vercel.com](https://vercel.com) — `vercel.json` auto-configures the build
3. Set env vars in Vercel dashboard:
   - `VITE_REOWN_PROJECT_ID` = your project ID
   - `VITE_PIPELINE_API_URL` = your Render URL (after step below)
4. Deploy — Vercel runs `cp deployments.json frontend/public/ && cd frontend && npm install && npm run build`

### AI Agent → Render

1. Go to [dashboard.render.com](https://dashboard.render.com) → New → Blueprint
2. Select your GitHub repo — Render reads `render.yaml` automatically
3. The Docker image (`ai-agent/Dockerfile`) runs three processes:
   - `market_simulator.js` — autonomous APY updates
   - `relayer.js` — autonomous rebalance pipeline
   - `api_server.js` — HTTP server for frontend telemetry
4. Set environment variables in Render dashboard:
   - `PRIVATE_KEY` — deployer/pool owner key (sync: false)
   - `TEE_PRIVATE_KEY` — TEE signing key (sync: false)
   - `VAULT_ADDRESS` — vault proxy address (sync: false, or read from deployments.json)
   - `CORS_ORIGIN` — your Vercel frontend URL

### Keep-Alive (Free Tier)

Render free tier sleeps after 15 min. Use [UptimeRobot](https://uptimerobot.com)
(free) to ping `https://your-render-app.onrender.com/health` every 10 minutes.

### State Persistence Note

Render free tier has **ephemeral filesystem** — `state.json` is lost on every
restart/redeploy. The relayer bootstraps a fresh `state.json` from on-chain
data on startup (`ensureStateFile()` reads pool APYs from the contracts).
Pipeline history and logs will reset on restart, but the frontend reads
**real on-chain vault data** directly via 0G RPC (AUM, allocations, APYs,
user balances) — that data is always live regardless of `state.json` state.
For persistent pipeline history, upgrade to a Render plan with a persistent
disk ($0.25/month for 1GB).

---

## Testing

```bash
cd contracts
forge test                    # all 57 tests
forge test -vvv               # verbose output
forge test --coverage          # coverage report
forge test --match-test testUpgrade   # specific test
```

Test suites:

| File | Tests | Coverage |
| :--- | :--- | :--- |
| `AIGovernedVault.t.sol` | 23 | Deposit/withdraw, rebalance, TEE sig, DA verification, slippage, upgrade |
| `LendingPool.t.sol` | 11 | Deposit, yield accrual, withdraw, APY changes |
| `AMMPool.t.sol` | 11 | Same as LendingPool |
| `USDC.t.sol` | 6 | Mint, minter controls, reverts |
| `W0G.t.sol` | 6 | Same as USDC |

---

## Project Structure

```
CogniVault/
├── contracts/                 # Foundry workspace
│   ├── src/                   # Smart contracts
│   ├── test/                  # Foundry tests + test helpers
│   ├── script/                # Deploy + upgrade scripts
│   ├── lib/                   # OZ, forge-std, OZ-upgradeable
│   └── foundry.toml
├── frontend/                  # React + Vite + Reown AppKit
│   ├── src/
│   │   ├── App.jsx            # Main dashboard
│   │   ├── config/            # wallet.js, contracts.js (ABIs)
│   │   └── hooks/             # useVault.js
│   ├── public/                # deployments.json, state.json (copied at build)
│   └── package.json
├── ai-agent/                  # Node.js + Python backend
│   ├── market_simulator.js    # Autonomous APY bot
│   ├── relayer.js             # Pipeline orchestrator
│   ├── compute_client.js      # 0G Compute TEE client
│   ├── da_client.js           # 0G DA disperser
│   ├── log_aggregator.js      # 0G Storage uploader
│   ├── api_server.js          # HTTP API server
│   ├── simulator.py           # Python optimizer
│   ├── storage_client.py      # 0G Storage downloader
│   ├── Dockerfile
│   └── package.json
├── deployments.json           # Single source of truth for addresses
├── state.json                 # Pipeline history + current strategy state
├── vercel.json                # Vercel build config
├── render.yaml                # Render Blueprint
├── plans/
│   ├── blueprint.md           # Project blueprint
│   └── execution_plan.md      # Development milestones + deployment architecture
└── README.md
```

---

## Key Design Decisions

- **UUPS over Transparent Proxy:** UUPS is more gas-efficient — the upgrade
  logic lives in the implementation, not a separate admin contract.
- **Vault-only upgradeable:** Tokens, pools, and oracle are stable
  infrastructure that rarely need upgrades. Only the vault is upgradeable.
- **`deployments.json` as single source of truth:** Every consumer (frontend,
  AI agent, Dockerfile) reads addresses from this file. Fresh deploys
  overwrite it; upgrades only change the implementation address.
- **Crypto-secure market simulation:** The bot uses `crypto.randomBytes()`
  with market regimes (stable, trending, volatile, crash, recovery) and
  mean-reverting random walks — no predictable loops.
- **Reown AppKit for wallet connection:** Solves multi-wallet extension
  conflicts via WalletConnect relay protocol. Supports 600+ wallets.
- **Real 0G integrations:** All three 0G layers (Storage, Compute, DA) are
  live. No mock modes or fallback code paths. The vault verifies DA proofs
  via the real 0G DA Entrance contract.
- **Split deployment:** Vercel (static frontend) + Render (persistent AI
  agent). Frontend reads on-chain data directly via 0G RPC; AI agent provides
  live pipeline telemetry via HTTP.

---

## License

MIT
