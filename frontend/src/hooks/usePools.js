import { ethers } from 'ethers';
import { POOL_ABI } from '../config/contracts';

export function usePools(provider) {
  const getPoolDetails = async (poolAddress, vaultAddress) => {
    if (!poolAddress || !provider) return { balance: 0, apy: 0 };
    try {
      const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
      const balance = await poolContract.balanceOf(vaultAddress);
      const apy = await poolContract.getAPY();
      return {
        balance: Number(ethers.formatUnits(balance, 6)),
        apy: Number(apy)
      };
    } catch (err) {
      console.error(`Error fetching pool details for ${poolAddress}:`, err);
      return { balance: 0, apy: 0 };
    }
  };

  return { getPoolDetails };
}
