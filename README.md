# CogniVault

CogniVault is an AI-governed decentralized yield optimization vault that secures strategies using 0G Storage, 0G DA, and verifiable TEE enclaves.

## Galileo Testnet Deployed Contracts

The smart contracts are deployed on the **0G Galileo Testnet** (Chain ID: `16602`).

| Contract Name | Address | Description |
| :--- | :--- | :--- |
| **MockUSDC** | `0x7cC78662e248FdF3F2B829DAa8858c8B0523340A` | Base asset used for deposits and yield generation |
| **MockW0G** | `0x6F31F0F723Cc2a59fB20dc8f0F62E95AA1Ed2645` | Wrapped 0G native token mock |
| **MockLendingPool** | `0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312` | Lending market yield pool |
| **MockAMMPool** | `0x3B084b5b2046E7651bb701d1cF729Be7Cb9fAf03` | Liquidity provider yield pool |
| **AIGovernedVault** | `0x9cdabBb1c06C37a7eD297f9a320b6B3518388A45` | Main Vault handling strategy rebalancing |
| **MockDAEntrance** | `0x1B62c5222126B63FEC3bc7D2Ab67575AEe9EbaF3` | Entrance portal for 0G Data Availability verification |
| **MockPriceOracle** | `0x86c7EEC7d74fDAA3699DcEdF745e022415a68A6C` | Oracle providing token price data for slippage safety |

## Network Configurations

*   **RPC URL**: `https://evmrpc-testnet.0g.ai`
*   **Chain ID**: `16602`
*   **Block Explorer**: [0G ChainScan Galileo](https://chainscan-galileo.0g.ai)