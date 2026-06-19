import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Wallet, Lock, TrendingUp, Database, Cpu, Shield, ArrowRightLeft,
  RefreshCw, Coins, Activity, Zap, CheckCircle2,
  Sparkles, ArrowDownRight, Settings
} from 'lucide-react';
import {
  useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect
} from '@reown/appkit/react';
import {
  POOL_ABI, DEFAULT_ADDRESSES,
  GALILEO_CHAIN_ID, GALILEO_RPC
} from './config/contracts';
import { useVault } from './hooks/useVault';

const STATE_JSON_URL = import.meta.env.VITE_PIPELINE_API_URL
  ? `${import.meta.env.VITE_PIPELINE_API_URL}/state.json`
  : '/state.json';
const SYNC_INTERVAL = 15000;

const POOL_META = {
  [DEFAULT_ADDRESSES.lendingPool.toLowerCase()]: { name: 'Lending Pool', risk: 1.2, color: '#00f2fe' },
  [DEFAULT_ADDRESSES.ammPool.toLowerCase()]: { name: 'AMM Pool', risk: 3.0, color: '#a855f7' }
};

function App() {
  // Reown AppKit hooks
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider('eip155');
  const { disconnect } = useDisconnect();

  // Protocol state (read-only, always visible)
  const [readOnlyProvider] = useState(
    () => new ethers.JsonRpcProvider(GALILEO_RPC, {
      name: '0G-Galileo-Testnet',
      chainId: GALILEO_CHAIN_ID
    })
  );
  const [blockNumber, setBlockNumber] = useState(0);
  const [vaultConfig, setVaultConfig] = useState(null);
  const [vaultMetrics, setVaultMetrics] = useState(null);
  const [poolDetails, setPoolDetails] = useState([]);
  const [netAPY, setNetAPY] = useState(0);
  const [sharePrice, setSharePrice] = useState(1);

  // User state (only when connected)
  const [userPosition, setUserPosition] = useState(null);
  const [isOwner, setIsOwner] = useState(false);

  // Pipeline
  const [pipelineState, setPipelineState] = useState(null);
  const [chartData, setChartData] = useState([]);

  // Actions
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [txPending, setTxPending] = useState(false);

  // Market sim
  const [lendingApyInput, setLendingApyInput] = useState(550);
  const [ammApyInput, setAmmApyInput] = useState(1200);
  const [marketShiftPending, setMarketShiftPending] = useState(false);
  const [rebalancePending, setRebalancePending] = useState(false);
  const [lastRebalanceTx, setLastRebalanceTx] = useState('');
  const [showMarketPanel, setShowMarketPanel] = useState(false);

  // Logs
  const [logs, setLogs] = useState([]);
  const logIdRef = useRef(0);
  const syncingRef = useRef(false);
  const configFetchedRef = useRef(false);

  const { deposit, redeem, executeAIStrategy, setPoolAPY,
    getVaultConfig, getVaultMetrics, getUserPosition } = useVault(
    DEFAULT_ADDRESSES.vault, DEFAULT_ADDRESSES.usdc, walletProvider, readOnlyProvider
  );

  const addLog = useCallback((type, text) => {
    const id = ++logIdRef.current;
    setLogs(prev => [...prev.slice(-80), { id, type, text, time: new Date().toLocaleTimeString() }]);
  }, []);

  // Protocol sync (always runs — read-only)
  const syncProtocol = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const blockNum = await readOnlyProvider.getBlockNumber();
      setBlockNumber(blockNum);

      const metrics = await getVaultMetrics();
      if (metrics) {
        setVaultMetrics(metrics);
        const sp = metrics.totalSupply > 0 ? metrics.totalAssets / metrics.totalSupply : 1;
        setSharePrice(sp);
      }

      if (!configFetchedRef.current) {
        const config = await getVaultConfig();
        if (config) {
          setVaultConfig(config);
          if (address && config.owner) {
            setIsOwner(config.owner.toLowerCase() === address.toLowerCase());
          }
          configFetchedRef.current = true;
        }
      }

      // Pools
      const pools = [];
      let weightedApy = 0;
      const totalDeployed = metrics ? metrics.totalAssets - metrics.idleBalance : 0;

      for (const addr of [DEFAULT_ADDRESSES.lendingPool, DEFAULT_ADDRESSES.ammPool]) {
        try {
          const poolContract = new ethers.Contract(addr, POOL_ABI, readOnlyProvider);
          const [bal, apy, pendingYield] = await Promise.all([
            poolContract.balanceOf(DEFAULT_ADDRESSES.vault),
            poolContract.getAPY(),
            poolContract.getPendingYield(DEFAULT_ADDRESSES.vault)
          ]);
          const balance = Number(ethers.formatUnits(bal, 6));
          const apyNum = Number(apy);
          const pending = Number(ethers.formatUnits(pendingYield, 6));
          if (totalDeployed > 0) weightedApy += (balance / totalDeployed) * apyNum;
          const meta = POOL_META[addr.toLowerCase()];
          pools.push({
            address: addr, name: meta?.name || 'Pool', risk: meta?.risk || 0,
            color: meta?.color || '#64748b', balance, apy: apyNum, pendingYield: pending
          });
        } catch {
          // skip
        }
      }
      setPoolDetails(pools);
      setNetAPY(weightedApy / 100);

      // User position (only when connected)
      if (address) {
        const pos = await getUserPosition(address);
        if (pos) setUserPosition(pos);
      }
    } catch (err) {
      if (err.code !== -32005 && err.code !== 'UNKNOWN_ERROR') {
        console.error('Sync error:', err);
      }
    } finally {
      syncingRef.current = false;
    }
  }, [readOnlyProvider, address, getVaultConfig, getVaultMetrics, getUserPosition]);

  // Poll protocol data
  useEffect(() => {
    Promise.resolve().then(() => syncProtocol());
    const interval = setInterval(syncProtocol, SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [syncProtocol]);

  // When wallet connects, reset config cache and re-sync
  useEffect(() => {
    if (isConnected && address) {
      configFetchedRef.current = false;
      addLog('system', `Wallet connected: ${address.slice(0, 8)}...${address.slice(-4)}`);
      Promise.resolve().then(() => syncProtocol());
    }
    if (!isConnected) {
      Promise.resolve().then(() => {
        setUserPosition(null);
        setIsOwner(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  // Pipeline fetch
  const fetchPipelineState = useCallback(async () => {
    try {
      const res = await fetch(STATE_JSON_URL);
      if (!res.ok) return;
      const data = await res.json();
      setPipelineState(data);
      if (data.history?.length > 0) {
        setChartData(data.history.map((h, i) => ({
          run: i + 1, label: `#${i + 1}`,
          lending: parseFloat(h.allocations[0] ? (h.allocations[0] / 100).toFixed(2) : 0),
          amm: parseFloat(h.allocations[1] ? (h.allocations[1] / 100).toFixed(2) : 0),
        })));
        if (data.pools) {
          setLendingApyInput(data.pools.lending?.apy || 550);
          setAmmApyInput(data.pools.amm?.apy || 1200);
        }
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => fetchPipelineState());
    const interval = setInterval(fetchPipelineState, 30000);
    return () => clearInterval(interval);
  }, [fetchPipelineState]);

  // Actions
  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) return;
    setTxPending(true);
    try {
      await deposit(amount, address, addLog, syncProtocol);
      setDepositAmount('');
    } catch { /* logged */ } finally { setTxPending(false); }
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) return;
    setTxPending(true);
    try {
      await redeem(amount, address, addLog, syncProtocol);
      setWithdrawAmount('');
    } catch { /* logged */ } finally { setTxPending(false); }
  };

  const handleMarketShift = async () => {
    if (!isOwner) return;
    setMarketShiftPending(true);
    try {
      addLog('system', 'Simulating market movement...');
      await setPoolAPY(DEFAULT_ADDRESSES.lendingPool, lendingApyInput, addLog);
      await setPoolAPY(DEFAULT_ADDRESSES.ammPool, ammApyInput, addLog);
      addLog('system', 'Market updated. AI agent will detect and rebalance.');
      syncProtocol();
    } catch { /* logged */ } finally { setMarketShiftPending(false); }
  };

  const handleTriggerRebalance = async () => {
    if (!pipelineState?.history?.length) {
      addLog('error', 'No signed strategy available.');
      return;
    }
    setRebalancePending(true);
    try {
      const latest = pipelineState.history[pipelineState.history.length - 1];
      const blobHash = `0x${latest.da_blob_hash}`;
      const dataRoot = latest.da_data_root ? `0x${latest.da_data_root}` : ethers.ZeroHash;
      addLog('system', 'Triggering rebalance from latest AI strategy...');
      const tx = await executeAIStrategy(
        latest.allocations, latest.targets,
        `0x${latest.signature}`, blobHash, dataRoot, addLog, syncProtocol
      );
      if (tx) { setLastRebalanceTx(tx.hash); addLog('system', 'Rebalance confirmed.'); }
    } catch { /* logged */ } finally { setRebalancePending(false); }
  };

  // Helpers
  const fmt = (n, d = 2) => (n != null && !isNaN(n)) ? n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '0.00';
  const fmtAddr = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : 'N/A';

  const vaultAUM = vaultMetrics?.totalAssets ?? 0;
  const idleBal = vaultMetrics?.idleBalance ?? 0;
  const totalPoolBal = poolDetails.reduce((s, p) => s + p.balance, 0) + idleBal;
  const allocationData = totalPoolBal > 0
    ? poolDetails.filter(p => p.balance > 0).map(p => ({
        name: p.name, pct: (p.balance / totalPoolBal) * 100, color: p.color, balance: p.balance
      })).concat(idleBal > 0 ? [{ name: 'Idle', pct: (idleBal / totalPoolBal) * 100, color: '#475569', balance: idleBal }] : [])
    : [];

  const latestRun = pipelineState?.history?.[pipelineState.history.length - 1];
  const pipelineSteps = [
    { label: '0G Storage', icon: Database, active: !!pipelineState?.latest_storage_root, detail: pipelineState?.latest_storage_root ? fmtAddr(pipelineState.latest_storage_root) : 'Waiting' },
    { label: '0G Compute', icon: Cpu, active: !!pipelineState?.history?.length, detail: pipelineState?.history?.length ? `${pipelineState.history.length} runs` : 'Idle' },
    { label: '0G DA', icon: Shield, active: !!pipelineState?.da_blob_hash, detail: pipelineState?.da_blob_hash ? fmtAddr(pipelineState.da_blob_hash) : 'Idle' },
    { label: '0G Chain', icon: ArrowRightLeft, active: !!lastRebalanceTx, detail: lastRebalanceTx ? fmtAddr(lastRebalanceTx) : 'Idle' }
  ];

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-header-left">
          <div className="header-logo-sm">
            <Lock size={18} style={{ color: '#080b11' }} />
          </div>
          <span className="header-name">CogniVault</span>
          <span className="header-net"><span className="net-dot" /> Galileo Live</span>
        </div>
        <div className="app-header-right">
          <button className="header-btn" onClick={() => setShowMarketPanel(!showMarketPanel)}>
            <Settings size={15} /> Market Sim
          </button>
          {isConnected ? (
            <button className="header-wallet" onClick={() => disconnect()}>
              <Wallet size={15} /> {fmtAddr(address)}
            </button>
          ) : (
            <button className="header-wallet connect" onClick={() => open()}>
              <Wallet size={15} /> Connect Wallet
            </button>
          )}
        </div>
      </header>

      <div className="app-body">
        {/* Protocol Metrics — always visible */}
        <section className="metrics-row">
          <div className="metric-item">
            <span className="metric-label">Vault AUM</span>
            <span className="metric-value cyan">${fmt(vaultAUM, 0)}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Net APY</span>
            <span className="metric-value" style={{ color: 'var(--c-success)' }}>{fmt(netAPY, 2)}%</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Active Pools</span>
            <span className="metric-value">{vaultConfig?.activePools?.length || 0}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Pending Yield</span>
            <span className="metric-value purple">+${fmt(poolDetails.reduce((s, p) => s + p.pendingYield, 0), 4)}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Block</span>
            <span className="metric-value mono">#{blockNumber.toLocaleString()}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">DA Verified</span>
            <span className="metric-value" style={{ color: vaultConfig?.daVerificationEnabled ? 'var(--c-success)' : 'var(--t-muted)' }}>
              {vaultConfig?.daVerificationEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
        </section>

        {/* User Position + Deposit/Withdraw — only when connected */}
        {isConnected && (
          <div className="grid-row grid-3">
            <div className="card card-position">
              <div className="card-header">
                <h3><Coins size={18} /> Your Position</h3>
              </div>
              <div className="position-main">
                <div className="position-value">
                  <span className="position-label">Current Value</span>
                  <span className="position-amount">${fmt(userPosition?.positionValue)}</span>
                </div>
                <div className="position-shares">
                  <span className="position-label">Shares</span>
                  <span className="position-num">{fmt(userPosition?.shares, 4)}</span>
                </div>
              </div>
              <div className="position-row">
                <div className="position-item">
                  <span className="muted">Wallet USDC</span>
                  <span>${fmt(userPosition?.usdcBalance)}</span>
                </div>
                <div className="position-item">
                  <span className="muted">Share Price</span>
                  <span>${fmt(sharePrice, 6)}</span>
                </div>
                <div className="position-item">
                  <span className="muted">Share of AUM</span>
                  <span>{vaultAUM > 0 && userPosition ? fmt((userPosition.positionValue / vaultAUM) * 100, 2) : '0.00'}%</span>
                </div>
              </div>
            </div>

            <div className="card card-action">
              <div className="card-header"><h3><TrendingUp size={18} /> Deposit</h3></div>
              <div className="action-body">
                <div className="input-wrap">
                  <input type="number" min="0" placeholder="0.00" value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleDeposit()} />
                  <span className="input-suffix">USDC</span>
                </div>
                <button className="btn-primary" onClick={handleDeposit} disabled={txPending || !depositAmount}>
                  {txPending ? 'Confirming...' : 'Deposit'}
                </button>
              </div>
            </div>

            <div className="card card-action">
              <div className="card-header"><h3><ArrowDownRight size={18} /> Withdraw</h3></div>
              <div className="action-body">
                <div className="input-wrap">
                  <input type="number" min="0" placeholder="0.00" value={withdrawAmount}
                    onChange={e => setWithdrawAmount(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleWithdraw()} />
                  <span className="input-suffix">USDC</span>
                </div>
                <button className="btn-secondary" onClick={handleWithdraw} disabled={txPending || !withdrawAmount}>
                  {txPending ? 'Confirming...' : 'Withdraw'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Not connected prompt */}
        {!isConnected && (
          <div className="connect-prompt">
            <div className="connect-prompt-inner">
              <Wallet size={24} />
              <p>Connect your wallet to deposit USDC and start earning</p>
              <button className="btn-primary" style={{ maxWidth: '240px' }} onClick={() => open()}>
                Connect Wallet
              </button>
            </div>
          </div>
        )}

        {/* Allocation + Performance */}
        <div className="grid-row grid-2-1">
          <div className="card">
            <div className="card-header">
              <h3><Activity size={18} /> Vault Allocation</h3>
              <span className="badge-live">{poolDetails.length} pools</span>
            </div>
            <div className="alloc-layout">
              <div className="donut-wrap">
                <svg width="100%" height="100%" viewBox="0 0 42 42" className="donut-svg">
                  <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="rgba(255,255,255,0.04)" strokeWidth="4" />
                  {allocationData.map((seg, i) => {
                    const prev = allocationData.slice(0, i).reduce((s, x) => s + x.pct, 0);
                    return (
                      <circle key={i} cx="21" cy="21" r="15.915" fill="transparent"
                        stroke={seg.color} strokeWidth="4"
                        strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
                        strokeDashoffset={-prev}
                        style={{ transition: 'stroke-dasharray 0.8s ease, stroke-dashoffset 0.8s ease' }}
                      />
                    );
                  })}
                </svg>
                <div className="donut-center">
                  <span className="donut-center-label">AUM</span>
                  <span className="donut-center-val">${fmt(vaultAUM, 0)}</span>
                </div>
              </div>
              <div className="alloc-pools">
                {poolDetails.map((pool, i) => (
                  <div className="pool-row" key={i}>
                    <div className="pool-row-left">
                      <span className="pool-dot" style={{ background: pool.color }} />
                      <div>
                        <div className="pool-name">{pool.name}</div>
                        <div className="pool-sub muted">Risk {pool.risk} · {fmtAddr(pool.address)}</div>
                      </div>
                    </div>
                    <div className="pool-row-right">
                      <div className="pool-apy">{(pool.apy / 100).toFixed(2)}%</div>
                      <div className="pool-bal muted">${fmt(pool.balance, 0)}</div>
                      <div className="pool-yield">+${fmt(pool.pendingYield, 4)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3><TrendingUp size={18} /> Performance</h3>
              <span className="badge-live">{chartData.length} runs</span>
            </div>
            {chartData.length > 0 ? (
              <div className="chart-wrap">
                <ResponsiveContainer>
                  <AreaChart data={chartData} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradLending" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00f2fe" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#00f2fe" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradAmm" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="%" />
                    <Tooltip contentStyle={{ background: '#0d121f', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', fontSize: '0.8rem' }} labelStyle={{ color: '#94a3b8' }} />
                    <Area type="monotone" dataKey="lending" name="Lending %" stroke="#00f2fe" strokeWidth={2} fill="url(#gradLending)" />
                    <Area type="monotone" dataKey="amm" name="AMM %" stroke="#a855f7" strokeWidth={2} fill="url(#gradAmm)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="chart-empty">
                <Activity size={28} />
                <p>No pipeline history yet</p>
              </div>
            )}
          </div>
        </div>

        {/* AI Activity + Pipeline */}
        <div className="grid-row grid-1-1">
          <div className="card card-terminal">
            <div className="card-header">
              <h3><Cpu size={18} /> AI Activity Feed</h3>
              <span className="badge-live"><span className="live-dot" /> Live</span>
            </div>
            <div className="terminal">
              <div className="terminal-body">
                {logs.length === 0 && <div className="term-line muted">Waiting for activity...</div>}
                {logs.map(log => (
                  <div key={log.id} className={`term-line term-${log.type}`}>
                    <span className="term-time">{log.time}</span>
                    {log.text}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3><Zap size={18} /> 0G Pipeline</h3>
              <button className="btn-sm" onClick={fetchPipelineState}>
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
            <div className="pipeline">
              {pipelineSteps.map((step, i) => (
                <div key={i} className={`pipeline-node ${step.active ? 'active' : ''}`}>
                  <div className="pipeline-node-icon"><step.icon size={16} /></div>
                  <div className="pipeline-node-body">
                    <span className="pipeline-node-label">{step.label}</span>
                    <span className="pipeline-node-detail muted">{step.detail}</span>
                  </div>
                  {step.active && <CheckCircle2 size={14} className="pipeline-check" />}
                </div>
              ))}
            </div>
            {latestRun && (
              <div className="pipeline-latest">
                <div className="pipeline-latest-row">
                  <span className="muted">Last Strategy</span>
                  <span className="mono">[{latestRun.allocations.join(', ')}] bps</span>
                </div>
                <div className="pipeline-latest-row">
                  <span className="muted">DA Root</span>
                  <span className="mono">{latestRun.da_data_root ? fmtAddr('0x' + latestRun.da_data_root) : 'N/A'}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Market Sim (collapsible, owner-gated) */}
        {showMarketPanel && (
          <div className="card card-market">
            <div className="card-header">
              <h3><Sparkles size={18} /> Market Simulation</h3>
              <span className={`badge ${isOwner ? 'badge-ok' : 'badge-warn'}`}>
                {isOwner ? 'Owner Connected' : 'Owner Only'}
              </span>
            </div>
            <p className="market-desc muted">
              Simulate real market yield changes. Adjust pool APYs to see CogniVault's AI autonomously detect and rebalance.
            </p>
            <div className="market-sliders">
              <div className="slider-row">
                <div className="slider-top">
                  <span>Lending Pool APY</span>
                  <span className="slider-val">{(lendingApyInput / 100).toFixed(2)}%</span>
                </div>
                <input type="range" min="100" max="2000" value={lendingApyInput}
                  disabled={!isOwner}
                  onChange={e => setLendingApyInput(parseInt(e.target.value))} />
              </div>
              <div className="slider-row">
                <div className="slider-top">
                  <span>AMM Pool APY</span>
                  <span className="slider-val">{(ammApyInput / 100).toFixed(2)}%</span>
                </div>
                <input type="range" className="purple" min="500" max="3000" value={ammApyInput}
                  disabled={!isOwner}
                  onChange={e => setAmmApyInput(parseInt(e.target.value))} />
              </div>
            </div>
            <div className="market-actions">
              <button className="btn-secondary" onClick={handleMarketShift} disabled={!isOwner || marketShiftPending}>
                <RefreshCw size={15} className={marketShiftPending ? 'spin' : ''} />
                {marketShiftPending ? 'Updating...' : 'Apply Market Change'}
              </button>
              <button className="btn-primary" onClick={handleTriggerRebalance} disabled={rebalancePending}>
                <Zap size={15} className={rebalancePending ? 'spin' : ''} />
                {rebalancePending ? 'Rebalancing...' : 'Trigger Rebalance'}
              </button>
            </div>
            {lastRebalanceTx && (
              <div className="market-tx">
                <CheckCircle2 size={14} /> Last rebalance: <span className="mono">{fmtAddr(lastRebalanceTx)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
