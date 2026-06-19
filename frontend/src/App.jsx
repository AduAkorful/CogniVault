import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { 
  TrendingUp, Shield, Database, Cpu, Play, RefreshCw, 
  ChevronRight, Info, CheckCircle2, ArrowRightLeft, 
  Wallet, Lock, Coins, FileText, ChevronDown, Settings 
} from 'lucide-react';
import { VAULT_ABI, ERC20_ABI, POOL_ABI, DEFAULT_ADDRESSES } from './config/contracts';
import { useVault } from './hooks/useVault';

const BLOCKS_PER_YEAR = 10512000; // 3 seconds per block
const LENDING_RISK = 1.2;
const AMM_RISK = 3.0;

function App() {
  // Chain Connection & Sandbox State
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [sandboxMode, setSandboxMode] = useState(true);

  // Galileo Testnet config states (persisted in localStorage)
  const [vaultAddress, setVaultAddress] = useState(localStorage.getItem('vault_address') || '');
  const [usdcAddress, setUsdcAddress] = useState(localStorage.getItem('usdc_address') || '');
  const [lendingPoolAddress, setLendingPoolAddress] = useState(localStorage.getItem('lending_pool_address') || '');
  const [ammPoolAddress, setAmmPoolAddress] = useState(localStorage.getItem('amm_pool_address') || '');
  const [priceOracleAddress, setPriceOracleAddress] = useState(localStorage.getItem('price_oracle_address') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [signer, setSigner] = useState(null);

  useEffect(() => {
    if (walletConnected && window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);
      provider.getSigner().then(setSigner).catch(console.error);
    } else {
      setSigner(null);
    }
  }, [walletConnected]);

  const { deposit: vaultDeposit, redeem: vaultRedeem } = useVault(vaultAddress, usdcAddress, signer);

  // Simulation State Variables
  const [blockNumber, setBlockNumber] = useState(12800540);
  const [userUSDC, setUserUSDC] = useState(25000); // User starts with 25k USDC
  const [userShares, setUserShares] = useState(0); // Shares minted for the user
  const [totalShares, setTotalShares] = useState(100000); // Total outstanding shares
  
  // Vault Assets under management (Principals)
  const [vaultLendingPrincipal, setVaultLendingPrincipal] = useState(60000); 
  const [vaultAmmPrincipal, setVaultAmmPrincipal] = useState(40000);
  const [vaultIdleUSDC, setVaultIdleUSDC] = useState(0);

  // Last action blocks (to track yield block by block)
  const [lendingLastBlock, setLendingLastBlock] = useState(12800540);
  const [ammLastBlock, setAmmLastBlock] = useState(12800540);

  // APYs
  const [lendingAPY, setLendingAPY] = useState(550); // 5.50% (basis points)
  const [ammAPY, setAMMAPY] = useState(1200); // 12.00% (basis points)
  const [riskLimit, setRiskLimit] = useState(2.0);

  // Active allocations (start at 60/40)
  const [lendingAllocBps, setLendingAllocBps] = useState(6000);
  const [ammAllocBps, setAmmAllocBps] = useState(4000);

  // Deposit/Withdrawal Input States
  const [depositAmount, setDepositAmount] = useState('5000');
  const [withdrawShares, setWithdrawShares] = useState('10000');

  // Pipeline execution animation state
  const [activeStep, setActiveStep] = useState(0); // 0 = idle, 1 = Storage, 2 = Compute, 3 = DA, 4 = EVM
  const [rebalancing, setRebalancing] = useState(false);
  const [storageRoot, setStorageRoot] = useState('0xe1b0defd92d2277d7a8239f648207fca3e731205a925f3dc740449280b9255f3');

  // Terminal Logs Feed
  const [logs, setLogs] = useState([
    { type: 'system', text: 'CogniVault AI Agent Daemon Initialized.' },
    { type: 'info', text: `TEE public key registered: 0x822B9030e8051cC296c5B76ad8B1Bcb9dbF8eB62` },
    { type: 'info', text: 'Currently listening for market APY movements.' }
  ]);

  // Performance history log (NAV over time)
  const [history, setHistory] = useState([
    { label: 'Run 1', vault: 100, baseline: 100 },
    { label: 'Run 2', vault: 104, baseline: 102 },
    { label: 'Run 3', vault: 109, baseline: 104 },
    { label: 'Run 4', vault: 115, baseline: 107 },
    { label: 'Run 5', vault: 122, baseline: 109 }
  ]);

  // Connect wallet helper
  const connectWallet = async () => {
    if (walletConnected) {
      setWalletConnected(false);
      setWalletAddress('');
      setSandboxMode(true);
      addLog('system', 'Wallet disconnected. Switched to sandbox simulator.');
    } else {
      if (!window.ethereum) {
        alert('MetaMask or another Web3 wallet provider was not detected.');
        return;
      }
      try {
        addLog('system', 'Requesting wallet connection...');
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        if (accounts.length > 0) {
          setWalletConnected(true);
          setWalletAddress(accounts[0]);
          setSandboxMode(false);
          addLog('system', `Wallet connected: ${accounts[0]}. Switched to Galileo Testnet mode.`);
        }
      } catch (err) {
        console.error(err);
        addLog('error', `Wallet connection failed: ${err.message}`);
      }
    }
  };

  // On-chain state sync
  const syncOnChainState = async () => {
    if (!window.ethereum || !walletConnected || sandboxMode) return;
    try {
      if (!vaultAddress || !usdcAddress || !lendingPoolAddress || !ammPoolAddress) {
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const userAddr = walletAddress;

      const vaultContract = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
      const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
      const lendingContract = new ethers.Contract(lendingPoolAddress, POOL_ABI, provider);
      const ammContract = new ethers.Contract(ammPoolAddress, POOL_ABI, provider);

      // Fetch block number
      const blockNum = await provider.getBlockNumber();
      setBlockNumber(blockNum);

      // Fetch user balances
      const usdcBal = await usdcContract.balanceOf(userAddr);
      const userSharesBal = await vaultContract.balanceOf(userAddr);
      
      const totalSharesBalRaw = await provider.call({
        to: vaultAddress,
        data: ethers.id("totalSupply()").substring(0, 10)
      });
      const totalSharesUint = totalSharesBalRaw !== "0x" ? ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], totalSharesBalRaw)[0] : 0n;

      setUserUSDC(Number(ethers.formatUnits(usdcBal, 6)));
      setUserShares(Number(ethers.formatUnits(userSharesBal, 18)));
      setTotalShares(Number(ethers.formatUnits(totalSharesUint, 18)));

      // Vault balances inside pools
      const lendingPoolBal = await lendingContract.balanceOf(vaultAddress);
      const ammPoolBal = await ammContract.balanceOf(vaultAddress);
      const idleBal = await usdcContract.balanceOf(vaultAddress);

      const formattedLending = Number(ethers.formatUnits(lendingPoolBal, 6));
      const formattedAmm = Number(ethers.formatUnits(ammPoolBal, 6));
      const formattedIdle = Number(ethers.formatUnits(idleBal, 6));

      setVaultLendingPrincipal(formattedLending);
      setVaultAmmPrincipal(formattedAmm);
      setVaultIdleUSDC(formattedIdle);

      // Fetch APYs
      const lendingApyVal = await lendingContract.getAPY();
      const ammApyVal = await ammContract.getAPY();
      setLendingAPY(Number(lendingApyVal));
      setAMMAPY(Number(ammApyVal));

      // Calculate allocations
      const totalPrincipal = formattedLending + formattedAmm + formattedIdle;
      if (totalPrincipal > 0) {
        setLendingAllocBps(Math.round((formattedLending * 10000) / totalPrincipal));
        setAmmAllocBps(Math.round((formattedAmm * 10000) / totalPrincipal));
      }

      setLendingLastBlock(blockNum);
      setAmmLastBlock(blockNum);

    } catch (err) {
      console.error("On-chain sync error:", err);
    }
  };

  // Wallet listeners
  useEffect(() => {
    if (window.ethereum) {
      const handleAccountsChanged = (accounts) => {
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          addLog('system', `Wallet account changed: ${accounts[0]}`);
        } else {
          setWalletConnected(false);
          setWalletAddress('');
          setSandboxMode(true);
          addLog('system', 'Wallet disconnected.');
        }
      };
      
      const handleChainChanged = () => {
        window.location.reload();
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

      return () => {
        if (window.ethereum.removeListener) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
      };
    }
  }, []);

  // Poll state on Galileo Testnet
  useEffect(() => {
    if (sandboxMode || !walletConnected) return;
    syncOnChainState();
    const interval = setInterval(syncOnChainState, 8000);
    return () => clearInterval(interval);
  }, [sandboxMode, walletConnected, vaultAddress, usdcAddress, lendingPoolAddress, ammPoolAddress]);

  // Live Deposit transaction logic
  const handleLiveDeposit = async (amount) => {
    await vaultDeposit(amount, walletAddress, addLog, syncOnChainState);
  };

  // Live Withdraw transaction logic
  const handleLiveWithdraw = async (shares) => {
    await vaultRedeem(shares, walletAddress, addLog, syncOnChainState);
  };

  // Log helper
  const addLog = (type, text) => {
    setLogs(prev => [...prev, { type, text }]);
    // Scroll terminal to bottom after render
    setTimeout(() => {
      const el = document.getElementById('terminal-feed');
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  };

  // Yield calculations block by block
  const getPendingLendingYield = () => {
    const delta = blockNumber - lendingLastBlock;
    if (delta <= 0) return 0;
    return (vaultLendingPrincipal * lendingAPY * delta) / (BLOCKS_PER_YEAR * 10000);
  };

  const getPendingAmmYield = () => {
    const delta = blockNumber - ammLastBlock;
    if (delta <= 0) return 0;
    return (vaultAmmPrincipal * ammAPY * delta) / (BLOCKS_PER_YEAR * 10000);
  };

  const pendingLendingYield = getPendingLendingYield();
  const pendingAmmYield = getPendingAmmYield();
  
  // Total AUM of the vault
  const totalLendingAssets = vaultLendingPrincipal + pendingLendingYield;
  const totalAmmAssets = vaultAmmPrincipal + pendingAmmYield;
  const totalVaultAssets = totalLendingAssets + totalAmmAssets + vaultIdleUSDC;

  // Share NAV
  const sharePrice = totalShares > 0 ? (totalVaultAssets / totalShares) : 1.0;

  // Fast forward blocks simulator
  const fastForwardBlocks = (count) => {
    setBlockNumber(prev => prev + count);
    addLog('system', `Simulating block fast-forward: +${count} blocks added.`);
    addLog('info', `Yield accrued block-by-block. Total assets expanded.`);
  };

  // Optimize & rebalance strategy simulation
  const handleRebalance = () => {
    if (rebalancing) return;
    setRebalancing(true);
    addLog('system', 'Rebalance triggered. Initializing 0G pipeline verification...');
    
    // Step 1: Storage
    setActiveStep(1);
    addLog('info', '[0G Storage] Querying historical yield and pool risk vectors...');
    
    setTimeout(() => {
      addLog('info', `[0G Storage] Merkle Root Detected: ${storageRoot}`);
      addLog('info', '[0G Storage] Downloading file & verifying Merkle path inclusion proof...');
      addLog('info', '[0G Storage] Proof verification complete. Ingested historical yield records.');
      
      // Step 2: Compute
      setActiveStep(2);
      addLog('info', '[0G Compute] Resolving optimization model in secure TEE...');
      
      // Calculate allocations based on APY and risk limits
      let targetLendingAlloc = 0;
      let targetAmmAlloc = 0;

      if (ammAPY > lendingAPY) {
        // Allocate max to AMM subject to risk
        let rawAmm = (riskLimit - LENDING_RISK) / (AMM_RISK - LENDING_RISK);
        rawAmm = Math.max(0, Math.min(1, rawAmm));
        targetAmmAlloc = Math.round(rawAmm * 10000);
        targetLendingAlloc = 10000 - targetAmmAlloc;
      } else {
        // Allocate max to Lending subject to risk
        let rawLending = (riskLimit - AMM_RISK) / (LENDING_RISK - AMM_RISK);
        rawLending = Math.max(0, Math.min(1, rawLending));
        targetLendingAlloc = Math.round(rawLending * 10000);
        targetAmmAlloc = 10000 - targetLendingAlloc;
      }

      setTimeout(() => {
        addLog('info', `[0G Compute] Optimization resolved allocations: Lending: ${targetLendingAlloc/100}%, AMM: ${targetAmmAlloc/100}%`);
        addLog('info', '[0G Compute] Cryptographically signing rebalance payload inside TEE...');
        
        // Step 3: DA
        setActiveStep(3);
        addLog('info', '[0G DA] Dispersing strategy payload and Merkle proof to 0G DA...');
        
        setTimeout(() => {
          const mockBlobHash = '0x' + Math.random().toString(16).substring(2, 18) + '...da';
          addLog('info', `[0G DA] Dispersed successfully. Blob Hash: ${mockBlobHash}`);
          
          // Step 4: EVM execution
          setActiveStep(4);
          addLog('info', '[0G Chain] Calling executeAIStrategy() on AIGovernedVault...');
          
          setTimeout(() => {
            // Commit the yield to the principals & apply new allocations
            const currentTotal = totalVaultAssets;
            const newLending = (currentTotal * targetLendingAlloc) / 10000;
            const newAmm = (currentTotal * targetAmmAlloc) / 10000;

            setVaultLendingPrincipal(newLending);
            setVaultAmmPrincipal(newAmm);
            setVaultIdleUSDC(0);
            
            // Reset block counters
            setLendingLastBlock(blockNumber);
            setAmmLastBlock(blockNumber);

            setLendingAllocBps(targetLendingAlloc);
            setAmmAllocBps(targetAmmAlloc);

            // Add to NAV performance history
            setHistory(prev => {
              const runNum = prev.length + 1;
              const lastVal = prev[prev.length - 1];
              // Simulated gain based on allocation efficiency vs holding 100% lending (baseline)
              const vaultNav = Math.round(lastVal.vault * (1 + (targetLendingAlloc * lendingAPY + targetAmmAlloc * ammAPY) / (10000 * 1000)));
              const baseNav = Math.round(lastVal.baseline * (1 + lendingAPY / 10000 / 100));
              return [...prev, { label: `Run ${runNum}`, vault: vaultNav, baseline: baseNav }];
            });

            addLog('system', 'Rebalance transaction executed and confirmed on-chain!');
            addLog('info', `✔ Vault positions successfully rotated.`);
            
            // Generate next storage root to simulate log aggregator upload
            const nextRoot = '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');
            setStorageRoot(nextRoot);
            addLog('system', `[0G Storage] Aggregated logs uploaded. New Merkle root: ${nextRoot}`);
            
            setActiveStep(0);
            setRebalancing(false);
          }, 1500);
        }, 1500);
      }, 1500);
    }, 1500);
  };

  // Deposit Action
  const handleDeposit = (e) => {
    e.preventDefault();
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) return;

    if (!sandboxMode) {
      handleLiveDeposit(depositAmount);
      return;
    }

    if (amount > userUSDC) {
      alert("Insufficient USDC balance");
      return;
    }

    // Yield accrued first
    setVaultLendingPrincipal(prev => prev + pendingLendingYield);
    setVaultAmmPrincipal(prev => prev + pendingAmmYield);
    setLendingLastBlock(blockNumber);
    setAmmLastBlock(blockNumber);

    // Calculate share minting
    const sharesToMint = totalShares > 0 ? (amount / sharePrice) : amount;
    
    // Perform transfer
    setUserUSDC(prev => prev - amount);
    setUserShares(prev => prev + sharesToMint);
    setTotalShares(prev => prev + sharesToMint);

    // Immediately deploy deposited funds according to current allocations
    const depLending = (amount * lendingAllocBps) / 10000;
    const depAmm = amount - depLending;
    setVaultLendingPrincipal(prev => prev + depLending);
    setVaultAmmPrincipal(prev => prev + depAmm);

    addLog('system', `Deposited ${amount.toLocaleString()} USDC to vault. Minted ${sharesToMint.toLocaleString(undefined, {maximumFractionDigits: 2})} shares.`);
  };

  // Withdraw Action
  const handleWithdraw = (e) => {
    e.preventDefault();
    const shares = parseFloat(withdrawShares);
    if (isNaN(shares) || shares <= 0) return;

    if (!sandboxMode) {
      handleLiveWithdraw(withdrawShares);
      return;
    }

    if (shares > userShares) {
      alert("Insufficient share balance");
      return;
    }

    // Yield accrued first
    const updatedLending = vaultLendingPrincipal + pendingLendingYield;
    const updatedAmm = vaultAmmPrincipal + pendingAmmYield;
    const updatedTotal = updatedLending + updatedAmm + vaultIdleUSDC;
    
    const usdcToReceive = shares * sharePrice;

    // Perform withdrawal proportionally
    const decLending = (usdcToReceive * (updatedLending / updatedTotal));
    const decAmm = usdcToReceive - decLending;

    setVaultLendingPrincipal(updatedLending - decLending);
    setVaultAmmPrincipal(updatedAmm - decAmm);
    setLendingLastBlock(blockNumber);
    setAmmLastBlock(blockNumber);

    setUserShares(prev => prev - shares);
    setTotalShares(prev => prev - shares);
    setUserUSDC(prev => prev + usdcToReceive);

    addLog('system', `Withdrew ${usdcToReceive.toLocaleString(undefined, {maximumFractionDigits: 2})} USDC from vault. Burned ${shares.toLocaleString()} shares.`);
  };

  // Donut chart stroke-dasharray calculation helpers
  const lendingPct = lendingAllocBps / 100;
  const ammPct = ammAllocBps / 100;
  const dashLending = `${lendingPct} ${100 - lendingPct}`;
  const dashAmm = `${ammPct} ${100 - ammPct}`;

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-logo">
          <div className="logo-icon">
            <Lock className="text-dark-900" size={24} style={{ color: '#080b11' }} />
          </div>
          <div className="logo-text">
            <h1>CogniVault</h1>
            <p>0G AI-GOVERNED OPTIMIZER</p>
          </div>
        </div>
        <div className="header-controls">
          <div className={`badge-status ${sandboxMode ? 'sandbox' : ''}`}>
            <span className="pulse-dot"></span>
            {sandboxMode ? 'Sandbox Simulator' : 'Galileo Testnet'}
          </div>
          <button className="badge-wallet" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} onClick={() => setShowSettings(!showSettings)}>
            <Settings size={16} />
            <span>Config</span>
          </button>
          <button className="badge-wallet" onClick={connectWallet}>
            <Wallet size={16} />
            <span>{walletConnected ? `${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}` : 'Connect Wallet'}</span>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="glass-card" style={{ padding: '1.5rem', border: '1px solid var(--color-primary)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Settings size={18} /> Galileo Testnet Configuration</h3>
            <button className="badge-status sandbox" style={{ cursor: 'pointer', border: 'none', background: 'rgba(0, 242, 254, 0.15)', color: 'var(--color-primary)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' }} onClick={() => {
              setVaultAddress(DEFAULT_ADDRESSES.vault); 
              setUsdcAddress(DEFAULT_ADDRESSES.usdc);
              setLendingPoolAddress(DEFAULT_ADDRESSES.lendingPool);
              setAmmPoolAddress(DEFAULT_ADDRESSES.ammPool);
              setPriceOracleAddress(DEFAULT_ADDRESSES.priceOracle);
              
              localStorage.setItem('vault_address', DEFAULT_ADDRESSES.vault);
              localStorage.setItem('usdc_address', DEFAULT_ADDRESSES.usdc);
              localStorage.setItem('lending_pool_address', DEFAULT_ADDRESSES.lendingPool);
              localStorage.setItem('amm_pool_address', DEFAULT_ADDRESSES.ammPool);
              localStorage.setItem('price_oracle_address', DEFAULT_ADDRESSES.priceOracle);
              addLog('system', 'Pre-populated Galileo testnet addresses.');
            }}>
              Prepopulate Example
            </button>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>AIGovernedVault Address</label>
              <input 
                type="text" 
                value={vaultAddress} 
                onChange={(e) => { setVaultAddress(e.target.value); localStorage.setItem('vault_address', e.target.value); }} 
                placeholder="0x..." 
                style={{ background: '#04060b', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.5rem', color: '#fff', fontSize: '0.85rem' }}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>MockUSDC Address</label>
              <input 
                type="text" 
                value={usdcAddress} 
                onChange={(e) => { setUsdcAddress(e.target.value); localStorage.setItem('usdc_address', e.target.value); }} 
                placeholder="0x..." 
                style={{ background: '#04060b', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.5rem', color: '#fff', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>MockLendingPool Address</label>
              <input 
                type="text" 
                value={lendingPoolAddress} 
                onChange={(e) => { setLendingPoolAddress(e.target.value); localStorage.setItem('lending_pool_address', e.target.value); }} 
                placeholder="0x..." 
                style={{ background: '#04060b', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.5rem', color: '#fff', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>MockAMMPool Address</label>
              <input 
                type="text" 
                value={ammPoolAddress} 
                onChange={(e) => { setAmmPoolAddress(e.target.value); localStorage.setItem('amm_pool_address', e.target.value); }} 
                placeholder="0x..." 
                style={{ background: '#04060b', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.5rem', color: '#fff', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', gridColumn: 'span 2' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>MockPriceOracle Address</label>
              <input 
                type="text" 
                value={priceOracleAddress} 
                onChange={(e) => { setPriceOracleAddress(e.target.value); localStorage.setItem('price_oracle_address', e.target.value); }} 
                placeholder="0x..." 
                style={{ background: '#04060b', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.5rem', color: '#fff', fontSize: '0.85rem' }}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button className="btn-secondary" style={{ padding: '0.5rem 1rem' }} onClick={() => setShowSettings(false)}>
              Close Panel
            </button>
            <button className="btn-primary" style={{ padding: '0.5rem 1rem' }} onClick={() => { syncOnChainState(); addLog('system', 'Config synced with on-chain data.'); }}>
              Sync Now
            </button>
          </div>
        </div>
      )}

      {/* Metrics Bar */}
      <section className="metrics-row col-12">
        <div className="metric-item">
          <span className="metric-label">Vault AUM (USDC)</span>
          <span className="metric-value cyan">
            ${totalVaultAssets.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="metric-item">
          <span className="metric-label">Accrued Yield (Pending)</span>
          <span className="metric-value purple">
            +${(pendingLendingYield + pendingAmmYield).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
          </span>
        </div>
        <div className="metric-item">
          <span className="metric-label">Net APY</span>
          <span className="metric-value text-emerald-400" style={{ color: 'var(--color-success)' }}>
            {((lendingAllocBps * lendingAPY + ammAllocBps * ammAPY) / 1000000).toFixed(2)}%
          </span>
        </div>
        <div className="metric-item">
          <span className="metric-label">Current Block</span>
          <span className="metric-value" style={{ fontFamily: 'var(--font-mono)' }}>
            #{blockNumber.toLocaleString()}
          </span>
        </div>
      </section>

      {/* Main Grid */}
      <div className="dashboard-grid">
        
        {/* Left Column: Allocations & Sliders */}
        <div className="col-8 glass-card">
          <div className="card-title">
            <h3><TrendingUp size={18} /> Portfolio Allocations & Risk Optimizer</h3>
            <span className="badge-status sandbox">Optimal Risk Threshold: {riskLimit}</span>
          </div>

          <div className="allocation-container">
            {/* Custom SVG Donut Chart */}
            <div className="donut-chart-wrapper">
              <svg width="100%" height="100%" viewBox="0 0 42 42" className="donut-chart-svg">
                <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="rgba(255,255,255,0.02)" strokeWidth="4"></circle>
                
                {/* Lending Pool segment */}
                <circle cx="21" cy="21" r="15.915" fill="transparent" 
                        className="donut-segment-lending"
                        strokeWidth="4" 
                        strokeDasharray={`${lendingPct} ${100 - lendingPct}`}
                        strokeDashoffset="0"></circle>
                
                {/* AMM Pool segment */}
                <circle cx="21" cy="21" r="15.915" fill="transparent" 
                        className="donut-segment-amm"
                        strokeWidth="4" 
                        strokeDasharray={`${ammPct} ${100 - ammPct}`}
                        strokeDashoffset={-lendingPct}></circle>
              </svg>
              <div className="chart-center-text">
                <p className="chart-center-label">AUM Split</p>
                <p className="chart-center-val">{lendingPct.toFixed(0)}/{ammPct.toFixed(0)}</p>
              </div>
            </div>

            {/* Allocations Legend */}
            <div className="allocation-legend">
              <div className="legend-item">
                <div className="legend-color-label">
                  <span className="legend-dot cyan"></span>
                  <div>
                    <p style={{ fontWeight: 600 }}>Lending Pool</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Risk score: {LENDING_RISK}</p>
                  </div>
                </div>
                <div>
                  <p className="legend-value">${totalLendingAssets.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-primary)', textAlign: 'right' }}>{lendingPct.toFixed(1)}%</p>
                </div>
              </div>

              <div className="legend-item">
                <div className="legend-color-label">
                  <span className="legend-dot purple"></span>
                  <div>
                    <p style={{ fontWeight: 600 }}>AMM Pool</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Risk score: {AMM_RISK}</p>
                  </div>
                </div>
                <div>
                  <p className="legend-value">${totalAmmAssets.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-secondary)', textAlign: 'right' }}>{ammPct.toFixed(1)}%</p>
                </div>
              </div>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)' }} />

          {/* Market Shift Controller */}
          <div className="card-title">
            <h3><RefreshCw size={18} /> Market Shift Controller (Simulation Panel)</h3>
          </div>

          <div className="slider-group">
            <div className="slider-item">
              <div className="slider-label">
                <span>Lending Pool Yield APY</span>
                <span>{(lendingAPY / 100).toFixed(2)}%</span>
              </div>
              <input 
                type="range" 
                min="100" 
                max="1500" 
                value={lendingAPY} 
                onChange={(e) => setLendingAPY(parseInt(e.target.value))}
              />
            </div>

            <div className="slider-item">
              <div className="slider-label">
                <span>AMM Pool Fee APY</span>
                <span>{(ammAPY / 100).toFixed(2)}%</span>
              </div>
              <input 
                type="range" 
                className="purple"
                min="500" 
                max="3000" 
                value={ammAPY} 
                onChange={(e) => setAMMAPY(parseInt(e.target.value))}
              />
            </div>
            
            <div className="slider-item">
              <div className="slider-label">
                <span>Risk Allowance Threshold</span>
                <span>{riskLimit.toFixed(1)}</span>
              </div>
              <input 
                type="range" 
                min="10" 
                max="30" 
                step="1"
                value={riskLimit * 10} 
                onChange={(e) => setRiskLimit(parseInt(e.target.value) / 10)}
              />
            </div>
          </div>

          {/* Control Triggers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
            <button className="btn-secondary" onClick={() => fastForwardBlocks(500)}>
              <Play size={16} /> Fast-Forward +500 Blocks
            </button>
            <button className="btn-primary" onClick={handleRebalance} disabled={rebalancing}>
              <RefreshCw size={16} className={rebalancing ? 'spin' : ''} />
              {rebalancing ? 'Optimizing Strategy...' : 'Trigger AI Rebalance'}
            </button>
          </div>
        </div>

        {/* Right Column: Interactive Transactions & Terminal */}
        <div className="col-4" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* User Vault Balance Card */}
          <div className="glass-card">
            <div className="card-title">
              <h3><Coins size={18} /> AI-Governed Vault Gateway</h3>
            </div>
            
            <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Your USDC Balance</span>
                <span style={{ fontWeight: 700 }}>${userUSDC.toLocaleString()} USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Your Vault Shares</span>
                <span style={{ fontWeight: 700 }}>{userShares.toLocaleString(undefined, {maximumFractionDigits: 0})} cSHARES</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Estimated Value</span>
                <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>${(userShares * sharePrice).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDC</span>
              </div>
            </div>

            {/* Deposit Form */}
            <form onSubmit={handleDeposit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ position: 'relative' }}>
                <input 
                  type="number" 
                  value={depositAmount} 
                  onChange={(e) => setDepositAmount(e.target.value)}
                  style={{ width: '100%', background: '#04060b', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', color: '#fff', fontSize: '0.9rem', outline: 'none' }}
                />
                <span style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>USDC</span>
              </div>
              <button type="submit" className="btn-primary" style={{ padding: '0.65rem' }}>
                Deposit into Vault
              </button>
            </form>

            {/* Withdraw Form */}
            <form onSubmit={handleWithdraw} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ position: 'relative' }}>
                <input 
                  type="number" 
                  value={withdrawShares} 
                  onChange={(e) => setWithdrawShares(e.target.value)}
                  style={{ width: '100%', background: '#04060b', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', color: '#fff', fontSize: '0.9rem', outline: 'none' }}
                />
                <span style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>SHARES</span>
              </div>
              <button type="submit" className="btn-secondary" style={{ padding: '0.65rem' }}>
                Withdraw from Vault
              </button>
            </form>
          </div>

          {/* AI Thought Feed Terminal */}
          <div className="glass-card" style={{ flex: 1 }}>
            <div className="card-title">
              <h3><Cpu size={18} /> AI Thought Feed (TEE logs)</h3>
            </div>
            
            <div className="terminal-window">
              <div className="terminal-header">
                <div className="terminal-dots">
                  <span className="terminal-dot red"></span>
                  <span className="terminal-dot yellow"></span>
                  <span className="terminal-dot green"></span>
                </div>
                <span className="terminal-title">tee-node-0g-compute</span>
              </div>
              <div className="terminal-content" id="terminal-feed">
                {logs.map((log, index) => (
                  <div key={index} className={`terminal-line ${log.type}`}>
                    &gt; {log.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 0G Pipeline State Visualizer */}
        <div className="col-12 glass-card">
          <div className="card-title">
            <h3><Database size={18} /> 0G Pipeline Transaction Cycle</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Verifiable AI Rebalance State Machine</span>
          </div>
          
          <div className="pipeline-flow">
            <div className={`pipeline-step ${activeStep === 1 ? 'active' : activeStep > 1 ? 'success' : ''}`}>
              <div className="pipeline-icon">
                <Database size={16} />
              </div>
              <h4>0G Storage</h4>
              <p>
                {activeStep > 1 
                  ? `Verified root: ${storageRoot.substring(0, 8)}...${storageRoot.substring(storageRoot.length - 4)}` 
                  : activeStep === 1 
                    ? 'Verifying Merkle proof...' 
                    : 'Idle state'}
              </p>
            </div>
            
            <div className={`pipeline-step ${activeStep === 2 ? 'active' : activeStep > 2 ? 'success' : ''}`}>
              <div className="pipeline-icon">
                <Cpu size={16} />
              </div>
              <h4>0G Compute</h4>
              <p>{activeStep > 2 ? 'TEE Signed payload' : activeStep === 2 ? 'Solving LP model...' : 'Idle state'}</p>
            </div>

            <div className={`pipeline-step ${activeStep === 3 ? 'active' : activeStep > 3 ? 'success' : ''}`}>
              <div className="pipeline-icon">
                <Shield size={16} />
              </div>
              <h4>0G DA</h4>
              <p>{activeStep > 3 ? 'Proof finalized' : activeStep === 3 ? 'Dispersing blob...' : 'Idle state'}</p>
            </div>

            <div className={`pipeline-step ${activeStep === 4 ? 'active' : activeStep > 4 ? 'success' : ''}`}>
              <div className="pipeline-icon">
                <ArrowRightLeft size={16} />
              </div>
              <h4>0G Chain (EVM)</h4>
              <p>{activeStep === 4 ? 'Executing rebalance...' : 'Idle state'}</p>
            </div>
          </div>
        </div>

        {/* Performance Graph Card */}
        <div className="col-12 glass-card">
          <div className="card-title">
            <h3><TrendingUp size={18} /> Profit & Performance vs Static Baseline</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Comparing AUM expansion over successive runs</span>
          </div>

          <div className="perf-graph-container">
            {history.map((h, i) => {
              // Calculate percentage height relative to max value
              const maxVal = Math.max(...history.map(item => Math.max(item.vault, item.baseline)));
              const vaultHeight = (h.vault / maxVal) * 100;
              const baseHeight = (h.baseline / maxVal) * 100;

              return (
                <div key={i} className="perf-bar-group">
                  <div className="perf-bars">
                    <div className="perf-bar baseline" style={{ height: `${baseHeight}%` }}></div>
                    <div className="perf-bar vault" style={{ height: `${vaultHeight}%` }}></div>
                  </div>
                  <span className="perf-label">{h.label}</span>
                </div>
              );
            })}
          </div>

          <div className="perf-legend-row">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px' }}></span>
              Static Single Pool (Lending APY only)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'linear-gradient(to top, var(--color-primary), var(--color-accent))', borderRadius: '3px', boxShadow: 'var(--glow-shadow)' }}></span>
              CogniVault (AI Rebalanced, Max Yield/Risk)
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
