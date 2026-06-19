import { ethers } from 'ethers';
import { PRICE_ORACLE_ABI } from '../config/contracts';

export function useOracle(oracleAddress, provider) {
  const getPrice = async (tokenAddress) => {
    if (!oracleAddress || !tokenAddress || !provider) return 0;
    try {
      const oracleContract = new ethers.Contract(oracleAddress, PRICE_ORACLE_ABI, provider);
      const price = await oracleContract.getPrice(tokenAddress);
      return Number(ethers.formatUnits(price, 8)); // 8 decimals standard for oracle
    } catch (err) {
      console.error(`Error fetching oracle price for ${tokenAddress}:`, err);
      return 0;
    }
  };

  return { getPrice };
}
