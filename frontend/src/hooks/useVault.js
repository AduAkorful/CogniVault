import { ethers } from 'ethers';
import { VAULT_ABI, ERC20_ABI } from '../config/contracts';

export function useVault(vaultAddress, usdcAddress, walletProvider, readOnlyProvider) {
  // Read-only contract (for view calls — works without wallet)
  const getReadContract = () => {
    if (!vaultAddress || !readOnlyProvider) return null;
    return new ethers.Contract(vaultAddress, VAULT_ABI, readOnlyProvider);
  };

  const getReadUsdc = () => {
    if (!usdcAddress || !readOnlyProvider) return null;
    return new ethers.Contract(usdcAddress, ERC20_ABI, readOnlyProvider);
  };

  // Write contract (for transactions — requires wallet)
  const getSigner = async () => {
    if (!walletProvider) throw new Error('Wallet not connected');
    const browserProvider = new ethers.BrowserProvider(walletProvider);
    return browserProvider.getSigner();
  };

  const getWriteContract = async () => {
    const signer = await getSigner();
    return new ethers.Contract(vaultAddress, VAULT_ABI, signer);
  };

  const getWriteUsdc = async () => {
    const signer = await getSigner();
    return new ethers.Contract(usdcAddress, ERC20_ABI, signer);
  };

  const deposit = async (amount, userAddress, addLog, onSuccess) => {
    try {
      addLog('system', `Depositing ${amount} USDC into vault...`);
      const vaultContract = await getWriteContract();
      const usdcContract = await getWriteUsdc();
      const parsedAmount = ethers.parseUnits(amount.toString(), 6);

      const allowance = await usdcContract.allowance(userAddress, vaultAddress);
      if (allowance < parsedAmount) {
        addLog('info', 'Approving USDC spending...');
        const approveTx = await usdcContract.approve(vaultAddress, parsedAmount);
        await approveTx.wait();
        addLog('info', 'USDC approved.');
      }

      addLog('info', 'Submitting deposit...');
      const tx = await vaultContract.deposit(parsedAmount, userAddress);
      addLog('info', `Tx: ${tx.hash}`);
      await tx.wait();
      addLog('system', 'Deposit confirmed!');
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error(err);
      addLog('error', `Deposit failed: ${err.reason || err.shortMessage || err.message}`);
      throw err;
    }
  };

  const redeem = async (amount, userAddress, addLog, onSuccess) => {
    try {
      addLog('system', `Withdrawing ${amount} USDC from vault...`);
      const vaultContract = await getWriteContract();
      const parsedShares = ethers.parseUnits(amount.toString(), 18);

      addLog('info', 'Submitting withdrawal...');
      const tx = await vaultContract.redeem(parsedShares, userAddress, userAddress);
      addLog('info', `Tx: ${tx.hash}`);
      await tx.wait();
      addLog('system', 'Withdrawal confirmed!');
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error(err);
      addLog('error', `Withdrawal failed: ${err.reason || err.shortMessage || err.message}`);
      throw err;
    }
  };

  const executeAIStrategy = async (allocations, targets, signature, daBlobHash, dataRoot, addLog, onSuccess) => {
    try {
      addLog('system', 'Executing AI strategy on-chain...');
      const vaultContract = await getWriteContract();
      const tx = await vaultContract.executeAIStrategy(
        allocations, targets, signature, daBlobHash, dataRoot
      );
      addLog('info', `Tx: ${tx.hash}`);
      await tx.wait();
      addLog('system', 'AI strategy executed successfully!');
      if (onSuccess) onSuccess();
      return tx;
    } catch (err) {
      console.error(err);
      addLog('error', `Strategy execution failed: ${err.reason || err.shortMessage || err.message}`);
      throw err;
    }
  };

  const setPoolAPY = async (poolAddress, apy, addLog) => {
    try {
      const signer = await getSigner();
      const poolContract = new ethers.Contract(poolAddress, ['function setAPY(uint256) external'], signer);
      const tx = await poolContract.setAPY(apy);
      await tx.wait();
      addLog('info', `APY set to ${(apy / 100).toFixed(2)}% for ${poolAddress.slice(0, 8)}...`);
      return tx;
    } catch (err) {
      addLog('error', `setAPY failed: ${err.reason || err.shortMessage || err.message}`);
      throw err;
    }
  };

  // Static config — rarely changes, fetch once
  const getVaultConfig = async () => {
    const vaultContract = getReadContract();
    if (!vaultContract) return null;
    try {
      const [activePools, maxSlippage, priceOracle, teeSigner, daEntrance, daEnabled, ownerAddr] = await Promise.all([
        vaultContract.getActivePools(),
        vaultContract.maxSlippageBps(),
        vaultContract.priceOracle(),
        vaultContract.teeSigner(),
        vaultContract.daEntranceContract(),
        vaultContract.daVerificationEnabled(),
        vaultContract.owner()
      ]);
      return {
        activePools,
        maxSlippageBps: Number(maxSlippage),
        priceOracle,
        teeSigner,
        daEntrance,
        daVerificationEnabled: daEnabled,
        owner: ownerAddr
      };
    } catch (err) {
      console.error('Error fetching vault config:', err);
      return null;
    }
  };

  // Dynamic metrics — polled frequently
  const getVaultMetrics = async () => {
    const vaultContract = getReadContract();
    const usdcContract = getReadUsdc();
    if (!vaultContract || !usdcContract) return null;
    try {
      const [totalAssets, totalSupply, idleBalance] = await Promise.all([
        vaultContract.totalAssets(),
        vaultContract.totalSupply(),
        usdcContract.balanceOf(vaultAddress)
      ]);
      return {
        totalAssets: Number(ethers.formatUnits(totalAssets, 6)),
        totalSupply: Number(ethers.formatUnits(totalSupply, 18)),
        idleBalance: Number(ethers.formatUnits(idleBalance, 6))
      };
    } catch (err) {
      console.error('Error fetching vault metrics:', err);
      return null;
    }
  };

  const getUserPosition = async (userAddress) => {
    const vaultContract = getReadContract();
    const usdcContract = getReadUsdc();
    if (!vaultContract || !usdcContract || !userAddress) return null;
    try {
      const [shares, usdcBal] = await Promise.all([
        vaultContract.balanceOf(userAddress),
        usdcContract.balanceOf(userAddress)
      ]);
      const assetsValue = await vaultContract.convertToAssets(shares);
      return {
        shares: Number(ethers.formatUnits(shares, 18)),
        usdcBalance: Number(ethers.formatUnits(usdcBal, 6)),
        positionValue: Number(ethers.formatUnits(assetsValue, 6))
      };
    } catch (err) {
      console.error('Error fetching user position:', err);
      return null;
    }
  };

  return {
    deposit, redeem, executeAIStrategy, setPoolAPY,
    getVaultConfig, getVaultMetrics, getUserPosition
  };
}
