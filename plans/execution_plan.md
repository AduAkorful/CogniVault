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

## 🗺️ Progress Dashboard

```
[x] Iteration 1: Foundation & Frontend WOW Factor (Deadline: June 23)
  [x] Checkpoint 1.1: Project Monorepo Initialization
  [x] Checkpoint 1.2: Core Smart Contracts (Mock Yield Ecosystem)
  [x] Checkpoint 1.3: Off-Chain AI Agent Simulator
  [x] Checkpoint 1.4: Premium React Frontend Dashboard
  [x] Checkpoint 1.5: Automated Testing & Verification
  [x] Checkpoint 1.6: Security Refinements (Gas & Loop Limits)
[ ] Iteration 2: 0G Storage Integration (Deadline: June 28)
  [ ] Checkpoint 2.1: Periodic DB Log Aggregator
  [ ] Checkpoint 2.2: AI Agent Storage SDK Integration
[ ] Iteration 3: 0G Compute Network Integration (Deadline: July 4)
  [ ] Checkpoint 3.1: 0G Compute SDK Inference requests
  [ ] Checkpoint 3.2: Solidity TEE Signature Verifier
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

#### [ ] Checkpoint 2.1: Periodic DB Log Aggregator
*   **Deliverables:**
    *   Deploy a node script that logs yield pool metrics to a local database and uploads it to 0G Storage as a `ZgFile`.
*   **Developer Execution Notes:**
    *   *Add script configuration details here.*

#### [ ] Checkpoint 2.2: AI Agent Storage SDK Integration
*   **Deliverables:**
    *   Update `/ai-agent/simulator.py` to retrieve historical records from 0G Storage, verify Merkle inclusion, and pass it as context to the rebalancing model.
*   **Developer Execution Notes:**
    *   *Add transaction/blob info here.*

---

### 🖥️ Iteration 3: 0G Compute Network Integration (Deadline: July 4)
**Objective:** Run the AI model in a verifiable TEE and verify the execution signature on-chain.

#### [ ] Checkpoint 3.1: 0G Compute SDK Inference Requests
*   **Deliverables:**
    *   Integrate `@0gfoundation/0g-compute-ts-sdk` broker client to dispatch inference tasks to active 0G compute providers.
*   **Developer Execution Notes:**
    *   *Add broker contract addresses and providers here.*

#### [ ] Checkpoint 3.2: Solidity TEE Signature Verifier
*   **Deliverables:**
    *   Register TEE signer keys inside the `AIGovernedVault` contract.
    *   Modify `executeAIStrategy` to verify the provider's ECDSA signature of the rebalance payload, ensuring it was calculated inside the TEE.
*   **Developer Execution Notes:**
    *   *Add verification logic details here.*

---

### 📡 Iteration 4: 0G DA Integration & Relayer (Deadline: July 8)
**Objective:** Disperse payloads to 0G DA, verify KZG commitments, and deploy a live relayer.

#### [ ] Checkpoint 4.1: 0G DA Client Disperser
*   **Deliverables:**
    *   Configure the backend to submit the signed strategy payload to the 0G DA Disperser, retrieving a `blobHash` and KZG proof.
*   **Developer Execution Notes:**
    *   *Add DA node endpoints here.*

#### [ ] Checkpoint 4.2: On-chain DA Proof Verification
*   **Deliverables:**
    *   Implement verification inside `executeAIStrategy` using the precompiled `DASigners` contract or Galileo's `DA Entrance` contract to assert the blob's availability on-chain.
*   **Developer Execution Notes:**
    *   *Add precompile address mapping and results here.*

#### [ ] Checkpoint 4.3: Live Relayer Bot Setup
*   **Deliverables:**
    *   Deploy an autonomous node script (Relayer) that listens for new strategy blobs on the DA network, retrieves the KZG proofs, and calls `executeAIStrategy` on the deployed vault.
*   **Developer Execution Notes:**
    *   *Add relayer setup and live transaction logs here.*

#### [ ] Checkpoint 4.4: Slippage Protection & Price Oracles
*   **Deliverables:**
    *   Implement oracle price integration (e.g., Pyth or Chainlink) and slippage thresholds within strategy reallocations to protect user assets from front-running and sandwich attacks when moving actual liquidity across real yield pools.
*   **Developer Execution Notes:**
    *   *Add price feeds and slippage calculation details here.*
