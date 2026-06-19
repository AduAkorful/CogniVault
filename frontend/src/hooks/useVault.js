import { ethers } from 'ethers';
import { VAULT_ABI, ERC20_ABI } from '../config/contracts';

export function useVault(vaultAddress, usdcAddress, signer) {
  const deposit = async (amount, userAddress, addLog, onSuccess) => {
    if (!vaultAddress || !usdcAddress || !signer) return;
    try {
      addLog('system', `Initiating live deposit of ${amount} USDC...`);
      const vaultContract = new ethers.Contract(vaultAddress, VAULT_ABI, signer);
      const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
      const parsedAmount = ethers.parseUnits(amount, 6);

      const allowance = await usdcContract.allowance(userAddress, vaultAddress);
      if (allowance < parsedAmount) {
        addLog('info', 'Approving USDC spending...');
        const approveTx = await usdcContract.approve(vaultAddress, parsedAmount);
        await approveTx.wait();
        addLog('info', 'USDC approval confirmed.');
      }

      addLog('info', 'Submitting deposit transaction to Vault...');
      const tx = await vaultContract.deposit(parsedAmount, userAddress);
      addLog('info', `Transaction submitted: ${tx.hash}`);
      await tx.wait();
      addLog('system', 'Deposit transaction confirmed!');
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error(err);
      addLog('error', `Deposit failed: ${err.reason || err.message || err}`);
    }
  };

  const redeem = async (shares, userAddress, addLog, onSuccess) => {
    if (!vaultAddress || !signer) return;
    try {
      addLog('system', `Initiating live withdrawal of ${shares} shares...`);
      const vaultContract = new ethers.Contract(vaultAddress, VAULT_ABI, signer);
      const parsedShares = ethers.parseUnits(shares, 18);

      addLog('info', 'Submitting redeem transaction to Vault...');
      const tx = await vaultContract.redeem(parsedShares, userAddress, userAddress);
      addLog('info', `Transaction submitted: ${tx.hash}`);
      await tx.wait();
      addLog('system', 'Withdrawal transaction confirmed!');
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error(err);
      addLog('error', `Withdrawal failed: ${err.reason || err.message || err}`);
    }
  };

  return { deposit, redeem };
}
