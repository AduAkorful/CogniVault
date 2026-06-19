export const VAULT_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function getActivePools() view returns (address[])",
  "function isWhitelistedPool(address) view returns (bool)",
  "function maxSlippageBps() view returns (uint256)",
  "function priceOracle() view returns (address)",
  "function teeSigner() view returns (address)",
  "function daEntranceContract() view returns (address)",
  "function daVerificationEnabled() view returns (bool)",
  "function owner() view returns (address)",
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function convertToShares(uint256) view returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
  "function previewRedeem(uint256) view returns (uint256)",
  "function deposit(uint256, address) returns (uint256)",
  "function withdraw(uint256, address, address) returns (uint256)",
  "function redeem(uint256, address, address) returns (uint256)",
  "function executeAIStrategy(uint256[] allocations, address[] targets, bytes signature, bytes32 daBlobHash, bytes32 dataRoot) external",
  "function setAPY(uint256) external",
  "event Rebalanced(address[] targets, uint256[] allocations, bytes32 indexed daBlobHash)"
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function symbol() view returns (string)",
  "function name() view returns (string)"
];

export const POOL_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function getAPY() view returns (uint256)",
  "function apy() view returns (uint256)",
  "function asset() view returns (address)",
  "function setAPY(uint256) external",
  "function deposit(uint256) external",
  "function withdraw(uint256) external",
  "function withdrawAll() external",
  "function getPendingYield(address) view returns (uint256)",
  "function deposits(address) view returns (uint256 principal, uint256 lastDepositBlock)"
];

export const PRICE_ORACLE_ABI = [
  "function latestRoundData(address) view returns (uint80, int256, uint256, uint256, uint80)",
  "function setPrice(address, int256) external"
];

export const DEFAULT_ADDRESSES = {
  vault: '0x9cdabBb1c06C37a7eD297f9a320b6B3518388A45',
  usdc: '0x7cC78662e248FdF3F2B829DAa8858c8B0523340A',
  lendingPool: '0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312',
  ammPool: '0x3B084b5b2046E7651bb701d1cF729Be7Cb9fAf03',
  priceOracle: '0x86c7EEC7d74fDAA3699DcEdF745e022415a68A6C',
  daEntrance: '0x1B62c5222126B63FEC3bc7D2Ab67575AEe9EbaF3'
};

export const GALILEO_CHAIN_ID = 16602;
export const GALILEO_RPC = 'https://evmrpc-testnet.0g.ai';
