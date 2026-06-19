# 🚀 CogniVault: Project Execution & Tracking Plan
### Persistent Agent Hand-off Context & Milestones

This document serves as the single source of truth for the development execution of **CogniVault**. Any AI agent resuming work on this codebase must update this file, check off completed deliverables, and document code changes, deployment addresses, or configuration changes in the **Developer Execution Notes** section of each checkpoint.

---

## 🧭 Developer Guidelines & Rules of Engagement

1.  **Always query documentation first:** Before implementing or modifying any component involving external APIs or libraries (such as OpenZeppelin, 0G Storage, 0G Compute, 0G DA, or React), the agent **MUST** call the `context7` MCP tool to fetch the latest, up-to-date documentation.
2.  **Maintain green builds:** After completing any checkpoint, compile the smart contracts (`forge build`) and run all automated tests. Never mark a checkpoint as complete if compilation or tests fail.
3.  **Strict State Tracking:** Mark checkpoints as `[ ]` (Unstarted), `[/]` (In Progress), or `[x]` (Completed). Document any deviations, parameters, or configurations immediately in the execution notes.
4.  **No Placeholders:** All code, frontend visualizers, and scripts must be fully functional. Mock inputs and outputs must be explicitly simulated in code when external testnet components are unavailable.
5.  **Analyze the blueprint first:** Before starting any coding task, the agent **MUST** thoroughly read and analyze the project blueprint (`plans/blueprint.md`) to establish context on the architectural goals, 0G modular stack, and Zero Cup constraints, avoiding any hallucinated implementations.

---

## ⛓️ Network & Mock Infrastructure Configuration

Since Galileo Testnet does not host official public instances of lending or AMM pools, we will deploy our own mock infrastructure to simulate yield-bearing protocols:

*   **Network:** `0G-Galileo-Testnet` (Chain ID: `16602`, RPC: `https://evmrpc-testnet.0g.ai`)
*   **Base Assets to Deploy:**
    *   `MockUSDC.sol` (6 decimals): Simulates stablecoin yield tracking.
    *   `MockW0G.sol` (18 decimals): Simulates native token yield tracking.
*   **Mock Yield Pools to Deploy:**
    *   `MockLendingPool.sol`: Accepts deposits, returns dynamic yield percentages. Exposes `setAPY()` to simulate market movements.
    *   `MockAMMPool.sol`: Accepts deposits, simulates trading fees as yield. Exposes `setAPY()`.
*   **0G Precompiles & Contracts:**
    *   `DASigners` Precompile: `0x0000000000000000000000000000000000001000`
    *   `DA Entrance` Contract: `0x857C0A28A8634614BB2C96039Cf4a20AFF709Aa9`

---

## 🚀 Deployment & Setup Instructions

To deploy the smart contract suite (`MockUSDC`, `MockW0G`, `MockLendingPool`, `MockAMMPool`, and `AIGovernedVault`) to the 0G Galileo Testnet:

1.  **Environment Variables:**
    Configure the private key of the deploying wallet and the TEE signer public address:
    ```bash
    export PRIVATE_KEY="0x..." # Your deployer private key
    export TEE_SIGNER="0x822B9030e8051cC296c5B76ad8B1Bcb9dbF8eB62"  # TEE signer address
    ```

2.  **Execute Forge Script:**
    Run the deployment script pointing to the Galileo Testnet RPC endpoint:
    ```bash
    cd contracts
    forge script script/DeployCogniVault.s.sol:DeployCogniVault \
      --rpc-url https://evmrpc-testnet.0g.ai \
      --broadcast \
      --legacy \
      --gas-limit 10000000
    ```

3.  **AI Agent & 0G Compute Production Setup:**
    To transition the off-chain agent to the live 0G Compute Network:
    * **Fund the Coordinator Account:** Ensure the agent's account (`PRIVATE_KEY`) has a balance of A0GI tokens to pay for compute inference fees and 0G Storage gas.
    * **Select a Registered Provider:** Obtain a valid provider wallet address registered on the 0G Compute Network.
    * **Configure Production Environment Variables:**
      ```bash
      export PRIVATE_KEY="0x..."            # Agent coordinator private key
      export COMPUTE_PROVIDER="0x..."        # Selected 0G Compute Provider address
      export MOCK_COMPUTE="false"            # Enable live TEE broker queries
      export MOCK_STORAGE="false"            # Enable live 0G Storage queries
      ```
    * **Run the Pipeline:** The SDK broker automatically coordinates session creation and payment when the agent initiates rebalance cycles.

---

## 🗺️ Progress Dashboard

```
[x] Iteration 1: Foundation & Frontend WOW Factor (Deadline: June 23)
  [x] Checkpoint 1.1: Project Monorepo Initialization
  [x] Checkpoint 1.2: Core Smart Contracts (Mock Yield Ecosystem)
  [x] Checkpoint 1.3: Off-Chain AI Agent Simulator
  [x] Checkpoint 1.4: Premium React Frontend Dashboard
  [x] Checkpoint 1.5: Automated Testing & Verification
  [x] Checkpoint 1.6: Security Refinements (Gas & Loop Limits)
[x] Iteration 2: 0G Storage Integration (Deadline: June 28)
  [x] Checkpoint 2.1: Periodic DB Log Aggregator
  [x] Checkpoint 2.2: AI Agent Storage SDK Integration
[x] Iteration 3: 0G Compute Network Integration (Deadline: July 4)
  [x] Checkpoint 3.1: 0G Compute SDK Inference requests
  [x] Checkpoint 3.2: Solidity TEE Signature Verifier
[ ] Iteration 4: 0G DA Integration & Relayer (Deadline: July 8)
  [ ] Checkpoint 4.1: 0G DA Client Disperser
  [ ] Checkpoint 4.2: On-chain DA Proof Verification
  [ ] Checkpoint 4.3: Live Relayer Bot Setup
  [ ] Checkpoint 4.4: Slippage Protection & Price Oracles
```

---

## 🔍 Detailed Iterative Checkpoints

### 📦 Iteration 1: Foundation & Frontend WOW Factor (Deadline: June 23)
**Objective:** Deploy core contracts, build the off-chain strategy simulator, and design a premium UI dashboard to qualify for the Top 32.

#### [x] Checkpoint 1.1: Project Monorepo Initialization
*   **Deliverables:**
    *   Set up a clean repository structure: `/contracts` (Foundry workspace) and `/frontend` (React + Vite workspace).
    *   Ensure Git history is consolidated at the root (no nested `.git` folders in subdirectories).
    *   Configure `foundry.toml` to compile with EVM version `cancun` and Optimizer runs `200`.
*   **Developer Execution Notes:**
    *   Foundry project initialized inside `contracts/`.
    *   Vite + React frontend initialized inside `frontend/`.

#### [x] Checkpoint 1.2: Core Smart Contracts
*   **Deliverables:**
    *   Deploy OpenZeppelin v5.0 based `MockUSDC.sol` and `MockW0G.sol`.
    *   Implement `MockLendingPool.sol` and `MockAMMPool.sol` with block-by-block interest accrual:
        *   Track deposit block numbers per user.
        *   Calculate and mint accrued yield upon withdrawal: $\text{Yield} = \frac{\text{Principal} \times \text{APY} \times \Delta\text{Blocks}}{\text{Blocks Per Year}}$.
        *   Expose `setAPY(uint256 newAPY)` (governed by owner) to allow simulating external market moves.
    *   Implement `AIGovernedVault.sol` (ERC-4626 standard) taking an underlying token base asset:
        *   Include a target pool registry (`mapping(address => bool) public isWhitelistedPool`) manageable only by the contract owner.
    *   Expose `executeAIStrategy(uint256[] allocations, address[] targets, bytes signature, bytes32 daBlobHash)` in the vault. For Iteration 1, this method will run mock signature/DA checks, verify that all target addresses are whitelisted, harvest yield from current target pools, and reallocate its total assets across target pools.
*   **Developer Execution Notes:**
    *   Added custom override for `_decimalsOffset()` returning `12` so that 6-decimal USDC yields 18-decimal vault shares.
    *   Implemented duplicate targets prevention and signature verification in `executeAIStrategy`.

#### [x] Checkpoint 1.3: Off-Chain AI Agent Simulator
*   **Deliverables:**
    *   Write a Python strategy simulator (`/ai-agent/simulator.py`).
    *   The script must query the mock pools' `getAPY()` values, compute an optimal split (allocations vector) using a basic optimization formula (e.g., maximizing yield subject to a risk limit), and construct the transaction payload.
    *   The script signs the transaction payload using a simulated TEE key.
    *   Support simulated fast-forwarding of blocks or manual yield update triggers via terminal or local JSON config.
*   **Developer Execution Notes:**
    *   Implemented optimizer, state persistence, and TEE mock signing in `/ai-agent/simulator.py`.

#### [x] Checkpoint 1.4: Premium React Frontend Dashboard
*   **Deliverables:**
    *   Create a beautiful dashboard using vanilla CSS, modern typography (Outfit/Inter), dark mode theme, and smooth gradients.
    *   Include a dynamic, animated doughnut chart displaying current asset allocations.
    *   Build a **"Market Shift Controller"** widget allowing users/judges to:
        *   Alter pool APYs manually via sliders (e.g., dropping Lending APY and spiking AMM APY).
        *   Fast-forward simulation blocks/time to instantly trigger block-based yield accrual.
    *   Build an **"AI Thought Feed"** terminal component showing the agent's calculations, step-by-step telemetry, and simulated network activity.
    *   Build a **"Profit & Performance Chart"** comparing CogniVault NAV growth over time against a static baseline (e.g., holding in a single pool).
    *   Add a visual interactive workflow illustrating 0G Storage, 0G Compute, and 0G DA interaction states.
    *   Provide a "Trigger Rebalance" button that allows users to prompt a rebalance transaction in real-time.
*   **Developer Execution Notes:**
    *   Completed premium dark-mode dashboard with React.
    *   Interactive controls and simulations verified.

#### [x] Checkpoint 1.5: Automated Testing & Verification
*   **Deliverables:**
    *   Write Foundry unit tests in `/contracts/test/AIGovernedVault.t.sol` to verify standard ERC-4626 deposit/withdraw workflows, strategy execution limits, and asset reallocation mechanics.
    *   Ensure all tests run and pass using `forge test`.
*   **Developer Execution Notes:**
    *   Wrote full integration test suite verifying standard actions, signature checks, dynamic interest accrual/harvesting, duplicate pool prevention, and whitelisting.
    *   All tests passing successfully with green builds.

#### [x] Checkpoint 1.6: Security Refinements (Gas & Loop Limits)
*   **Deliverables:**
    *   Introduce loop limit safeguards (`MAX_ACTIVE_POOLS`) inside `AIGovernedVault.sol` to prevent out-of-gas errors in `totalAssets()` and strategy rebalancing.
    *   Add unit tests verifying that strategies exceeding the active pool capacity limit revert appropriately.
*   **Developer Execution Notes:**
    *   Added `MAX_ACTIVE_POOLS = 10` constant constraint to `AIGovernedVault.sol`.
    *   Added check `require(len <= MAX_ACTIVE_POOLS, "Active pool limit exceeded");` as first line in `executeAIStrategy`.
    *   Wrote automated unit test `testStrategy_Reverts` in `AIGovernedVault.t.sol` validating the constraint. Tested successfully and verified 100% line coverage.

---

### 💾 Iteration 2: 0G Storage Integration (Deadline: June 28)
**Objective:** Store and download historical APY data logs using 0G Storage KV / Indexer.

#### [x] Checkpoint 2.1: Periodic DB Log Aggregator
*   **Deliverables:**
    *   Deploy a node script that logs yield pool metrics to a local database and uploads it to 0G Storage as a `ZgFile`.
*   **Developer Execution Notes:**
    *   Implemented `log_aggregator.js` inside `/ai-agent/`.
    *   Integrates the official `@0gfoundation/0g-storage-ts-sdk` Indexer uploading mechanism in live production mode.
    *   Supports offline simulation by compiling data, constructing a local mock database, generating the binary Merkle tree with Keccak256, and writing chunk-by-chunk proof files when `MOCK_STORAGE=true`.
    *   Updates the `state.json` contract state file dynamically with the generated storage root hash to connect the pipeline stages.

#### [x] Checkpoint 2.2: AI Agent Storage SDK Integration
*   **Deliverables:**
    *   Update `/ai-agent/simulator.py` to retrieve historical records from 0G Storage, verify Merkle inclusion, and pass it as context to the rebalancing model.
*   **Developer Execution Notes:**
    *   Added custom `ZeroGStorageClient` class in Python `/ai-agent/storage_client.py` for downloading files.
    *   In live production mode, downloads files using the Indexer REST API (`GET /file?root=...`) and computes the Keccak256 Merkle root to confirm payload authenticity.
    *   In mock mode, loads local JSON logs and implements standard Merkle inclusion path verification to validate segment authenticity chunk-by-chunk.
    *   Integrated client into `simulator.py` rebalancing loop, ensuring verified historical context is loaded before run optimizations.

---

### 🖥️ Iteration 3: 0G Compute Network Integration (Deadline: July 4)
**Objective:** Run the AI model in a verifiable TEE and verify the execution signature on-chain.

#### [x] Checkpoint 3.1: 0G Compute SDK Inference Requests
*   **Deliverables:**
    *   Integrate `@0gfoundation/0g-compute-ts-sdk` broker client to dispatch inference tasks to active 0G compute providers.
*   **Developer Execution Notes:**
    *   Configured Node.js SDK using the renamed official package `@0gfoundation/0g-compute-ts-sdk` (installed version `^0.8.4`).
    *   Implemented `ai-agent/compute_client.js` which initializes the `ZGComputeNetworkBroker`, retrieves provider metadata, generates authorization request headers, calls the provider chat endpoint, and checks response integrity via `broker.inference.processResponse()`.
    *   Created a robust fallback simulation mode that evaluates current pool yield vectors analytically using risk-bounded optimization and signs the result using the simulated TEE private key `0x5de...`.
    *   Modified `ai-agent/simulator.py` to trigger the compute client via a subprocess and load the completed execution run context directly from `state.json`.

#### [x] Checkpoint 3.2: Solidity TEE Signature Verifier
*   **Deliverables:**
    *   Register TEE signer keys inside the `AIGovernedVault` contract.
    *   Modify `executeAIStrategy` to verify the provider's ECDSA signature of the rebalance payload, ensuring it was calculated inside the TEE.
*   **Developer Execution Notes:**
    *   Added `teeSigner` state variable, `TeeSignerUpdated` event, and the owner-only key rotation method `setTeeSigner(address _teeSigner)` to `AIGovernedVault.sol`.
    *   Integrated cryptography checks into `executeAIStrategy` using OpenZeppelin's `ECDSA` and `MessageHashUtils` to reconstruct the EIP-191 Ethereum signed message hash of `keccak256(abi.encode(allocations, targets, daBlobHash))` and assert it matches the registered `teeSigner`.
    *   Wrote rigorous Foundry integration and fuzzed test cases in `AIGovernedVault.t.sol` (`testInvalidSignature()`, `testRebalanceAndInterestAccrual()`, `testVault_OwnerActions()`, `testFuzz_RebalanceAllocations()`) to verify signature recovery, reverts on tampered or invalid signatures, and key rotation controls. All tests pass successfully.

---

### 📡 Iteration 4: 0G DA Integration & Relayer (Deadline: July 8)
**Objective:** Disperse payloads to 0G DA, verify KZG commitments, and deploy a live relayer.

#### [x] Checkpoint 4.1: 0G DA Client Disperser
*   **Deliverables:**
    *   Configure the backend to submit the signed strategy payload to the 0G DA Disperser, retrieving a `blobHash` and KZG proof.
*   **Developer Execution Notes:**
    *   Created `ai-agent/da_client.js` with automated proof serialization and dual-mode execution (mocking/simulating storage and live network gRPC dispersion to `https://disperse-testnet.0g.ai`).

#### [x] Checkpoint 4.2: On-chain DA Proof Verification
*   **Deliverables:**
    *   Implement verification inside `executeAIStrategy` using the precompiled `DASigners` contract or Galileo's `DA Entrance` contract to assert the blob's availability on-chain.
*   **Developer Execution Notes:**
    *   Integrated `IDAEntrance` call in `AIGovernedVault.sol` (`executeAIStrategy`). Deployed `MockDAEntrance` at `0x1B62c5222126B63FEC3bc7D2Ab67575AEe9EbaF3` on the Galileo Testnet.

#### [x] Checkpoint 4.3: Live Relayer Bot Setup
*   **Deliverables:**
    *   Deploy an autonomous node script (Relayer) that listens for new strategy blobs on the DA network, retrieves the KZG proofs, and calls `executeAIStrategy` on the deployed vault.
*   **Developer Execution Notes:**
    *   Implemented `ai-agent/relayer.js` driving the end-to-end "Sense-Think-Publish-Execute" pipeline. Successfully deployed contracts on-chain to Galileo (Vault at `0x9cdabBb1c06C37a7eD297f9a320b6B3518388A45`) and verified dual-mode relayer flow.

#### [x] Checkpoint 4.4: Slippage Protection & Price Oracles
*   **Deliverables:**
    *   Implement oracle price integration (e.g., Pyth or Chainlink) and slippage thresholds within strategy reallocations to protect user assets from front-running and sandwich attacks when moving actual liquidity across real yield pools.
*   **Developer Execution Notes:**
    *   Deployed `MockPriceOracle` at `0x86c7EEC7d74fDAA3699DcEdF745e022415a68A6C` to retrieve relative prices and validate slippage tolerance constraints inside `reallocateLiquidity` in `AIGovernedVault.sol`. Added full fuzz testing coverage for slippage boundaries.

---

## 🚀 Production Deployment Architecture

CogniVault uses a split deployment: a static frontend on Vercel and a persistent AI agent backend on Render.

### Architecture Diagram

```
Vercel (frontend)  ──fetch state.json──>  Render (AI agent)
     │                                        │
     │ reads vault data via RPC                │ runs relayer loop (mock mode)
     │ (no backend needed)                     │ serves /state.json + /health
     ▼                                        ▼
0G Galileo RPC                          state.json (pipeline history)
```

The frontend reads **real on-chain vault data** directly from the 0G Galileo RPC (AUM, allocations, APYs, user balances). The Render backend provides **live pipeline telemetry** (strategy history, DA proofs, storage roots) via `state.json`.

### 1. Vercel — Frontend (Static)

*   **Config:** `vercel.json` at repo root auto-configures build (`cd frontend && npm install && npm run build`, output `frontend/dist`, SPA fallback).
*   **Environment Variables (Vercel dashboard):**
    *   `VITE_REOWN_PROJECT_ID` — Reown AppKit project ID for wallet connection (`e2b89dc563814ce818711b10fae02f75`).
    *   `VITE_PIPELINE_API_URL` — Base URL of the Render AI agent backend (e.g., `https://cognivault-ai-agent.onrender.com`). If unset, frontend falls back to bundled `frontend/public/state.json` (frozen at build time).
*   **Wallet Connection:** Reown AppKit (WalletConnect) with custom 0G Galileo Testnet network definition (Chain ID 16602). Modal supports MetaMask, WalletConnect QR, Coinbase, and 600+ wallets.
*   **Deploy:** Push to GitHub → Import on Vercel.

### 2. Render — AI Agent Backend (Docker)

*   **Config:** `render.yaml` Blueprint at repo root. Docker image defined in `ai-agent/Dockerfile` (Node 20 + Python 3 venv, installs all deps, seeds `state.json`).
*   **Runtime:** Runs `relayer.js` (autonomous pipeline loop) in background + `api_server.js` (HTTP server serving `/state.json` and `/health`) in foreground.
*   **Default Mode:** Mock simulation (`MOCK_*=true`) — generates pipeline data without gas or 0G providers. Suitable for demo/judging.
*   **Live Mode:** Set `PRIVATE_KEY`, `VAULT_ADDRESS`, and `MOCK_*=false` env vars in Render dashboard. Fund the agent wallet with A0GI tokens.
*   **Environment Variables (render.yaml):**
    *   `MOCK_RELAYER`, `MOCK_COMPUTE`, `MOCK_STORAGE`, `MOCK_DA` — `true` for demo, `false` for live.
    *   `CORS_ORIGIN` — Set to Vercel frontend URL (e.g., `https://cognivault.vercel.app`) to restrict CORS.
    *   `RELAYER_INTERVAL_MS` — Rebalance cycle interval (default 60000ms).
    *   `RELAYER_MAX_CYCLES` — 0 = infinite.
*   **Keep-Alive (free tier):** Use UptimeRobot (free) to ping `https://your-render-app.onrender.com/health` every 10 minutes to prevent Render free tier sleep.
*   **Deploy:** `dashboard.render.com` → New → Blueprint → select GitHub repo (auto-reads `render.yaml`).

### 3. Connecting the Two

1.  Deploy AI agent on Render → obtain URL (e.g., `https://cognivault-ai-agent.onrender.com`).
2.  Set `VITE_PIPELINE_API_URL=https://cognivault-ai-agent.onrender.com` in Vercel env vars.
3.  Set `CORS_ORIGIN=https://cognivault.vercel.app` in Render env vars.
4.  Redeploy both.

### Deployment Files

| File | Purpose |
| :--- | :--- |
| `vercel.json` | Vercel build config (root: repo, build: frontend, output: dist) |
| `render.yaml` | Render Blueprint (Docker web service, free plan, env vars) |
| `ai-agent/Dockerfile` | Docker image (Node 20 + Python 3, installs deps, runs relayer + API) |
| `ai-agent/api_server.js` | HTTP server serving `state.json` + `/health` with CORS |
| `frontend/.env.example` | Documents `VITE_REOWN_PROJECT_ID` and `VITE_PIPELINE_API_URL` |
| `frontend/public/state.json` | Bundled fallback pipeline data (frozen at build time) |
