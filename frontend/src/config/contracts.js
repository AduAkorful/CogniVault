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
  "function executeAIStrategy(uint256[] allocations, address[] targets, bytes signature, bytes32 daBlobHash, bytes32 dataRoot, uint256 daEpoch, uint256 daQuorumId) external",
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

export const GALILEO_CHAIN_ID = 16602;
export const GALILEO_RPC = 'https://evmrpc-testnet.0g.ai';
