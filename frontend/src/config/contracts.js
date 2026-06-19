export const VAULT_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function getActivePools() view returns (address[])",
  "function maxSlippageBps() view returns (uint256)",
  "function priceOracle() view returns (address)",
  "function teeSigner() view returns (address)",
  "function deposit(uint256, address) returns (uint256)",
  "function withdraw(uint256, address, address) returns (uint256)",
  "function redeem(uint256, address, address) returns (uint256)"
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

export const POOL_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function getAPY() view returns (uint256)",
  "function asset() view returns (address)"
];

export const PRICE_ORACLE_ABI = [
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function setPrice(address, int256) external",
  "function getPrice(address) view returns (int256)"
];

export const DEFAULT_ADDRESSES = {
  vault: '0x9cdabBb1c06C37a7eD297f9a320b6B3518388A45',
  usdc: '0x7cC78662e248FdF3F2B829DAa8858c8B0523340A',
  lendingPool: '0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312',
  ammPool: '0x3B084b5b2046E7651bb701d1cF729Be7Cb9fAf03',
  priceOracle: '0x86c7EEC7d74fDAA3699DcEdF745e022415a68A6C'
};
