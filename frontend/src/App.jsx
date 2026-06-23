import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Wallet, Lock, TrendingUp, Database, Cpu, Shield, ArrowRightLeft,
  RefreshCw, Coins, Activity, Zap, CheckCircle2, ArrowDownRight, Loader2
} from 'lucide-react';
import {
  useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect
} from '@reown/appkit/react';
import {
  POOL_ABI, GALILEO_CHAIN_ID, GALILEO_RPC
} from './config/contracts';
import { useVault } from './hooks/useVault';

// Contract addresses are static — always load from the build-time bundle.
const DEPLOYMENTS_URL = '/deployments.json';
// Live pipeline telemetry comes from the Render API when configured.
const PIPELINE_API = import.meta.env.VITE_PIPELINE_API_URL?.replace(/\/$/, '') || 'https://cognivault-ai-agent.onrender.com';
const STATE_JSON_URL = PIPELINE_API ? `${PIPELINE_API}/state.json` : '/state.json';
const SYNC_INTERVAL = 15000;

function App() {
  // Reown AppKit hooks
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider('eip155');
  const { disconnect } = useDisconnect();

  // Deployments (loaded from deployments.json)
  const [deployments, setDeployments] = useState(null);
  const [deploymentsLoading, setDeploymentsLoading] = useState(true);

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

  // Pipeline
  const [pipelineState, setPipelineState] = useState(null);

  // Actions
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [txPending, setTxPending] = useState(false);

  // Logs
  const [logs, setLogs] = useState([]);
  const logIdRef = useRef(0);
  const syncingRef = useRef(false);
  const configFetchedRef = useRef(false);

  // Derive addresses from deployments
  const vaultAddr = deployments?.contracts?.vault?.proxy || '';
  const usdcAddr = deployments?.contracts?.usdc?.address || '';
  const lendingPoolAddr = deployments?.contracts?.lendingPool?.address || '';
  const ammPoolAddr = deployments?.contracts?.ammPool?.address || '';

  const { deposit, redeem,
    getVaultConfig, getVaultMetrics, getUserPosition } = useVault(
    vaultAddr, usdcAddr, walletProvider, readOnlyProvider
  );

  const addLog = useCallback((type, text) => {
    const id = ++logIdRef.current;
    setLogs(prev => [...prev.slice(-80), { id, type, text, time: new Date().toLocaleTimeString() }]);
  }, []);

  // Fetch deployments.json
  const fetchDeployments = useCallback(async () => {
    try {
      const res = await fetch(DEPLOYMENTS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDeployments(data);
    } catch (err) {
      console.error('Failed to load deployments.json:', err);
      addLog('error', 'Failed to load contract addresses. Ensure deployments.json exists.');
    } finally {
      setDeploymentsLoading(false);
    }
  }, [addLog]);

  useEffect(() => {
    Promise.resolve().then(() => fetchDeployments());
  }, [fetchDeployments]);

  // Protocol sync (always runs — read-only)
  const syncProtocol = useCallback(async () => {
    if (syncingRef.current || !vaultAddr || !usdcAddr) return;
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
          configFetchedRef.current = true;
        }
      }

      // Pools
      const pools = [];
      let weightedApy = 0;
      const totalDeployed = metrics ? metrics.totalAssets - metrics.idleBalance : 0;

      for (const [addr, meta] of [[lendingPoolAddr, { name: 'Lending Pool', risk: 1.2, color: '#00f2fe' }], [ammPoolAddr, { name: 'AMM Pool', risk: 3.0, color: '#a855f7' }]]) {
        if (!addr) continue;
        try {
          const poolContract = new ethers.Contract(addr, POOL_ABI, readOnlyProvider);
          const [bal, apy, pendingYield] = await Promise.all([
            poolContract.balanceOf(vaultAddr),
            poolContract.getAPY(),
            poolContract.getPendingYield(vaultAddr)
          ]);
          const balance = Number(ethers.formatUnits(bal, 6));
          const apyNum = Number(apy);
          const pending = Number(ethers.formatUnits(pendingYield, 6));
          if (totalDeployed > 0) weightedApy += (balance / totalDeployed) * apyNum;
          pools.push({ address: addr, ...meta, balance, apy: apyNum, pendingYield: pending });
        } catch {
          // skip
        }
      }
      setPoolDetails(pools);
      setNetAPY(weightedApy / 100);

      // User position
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
  }, [readOnlyProvider, vaultAddr, usdcAddr, lendingPoolAddr, ammPoolAddr, address, getVaultConfig, getVaultMetrics, getUserPosition]);

  // Poll protocol data
  useEffect(() => {
    if (!deployments) return;
    Promise.resolve().then(() => syncProtocol());
    const interval = setInterval(syncProtocol, SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [deployments, syncProtocol]);

  // When wallet connects, reset config cache and re-sync
  useEffect(() => {
    if (isConnected && address) {
      configFetchedRef.current = false;
      addLog('system', `Wallet connected: ${address.slice(0, 8)}...${address.slice(-4)}`);
      Promise.resolve().then(() => syncProtocol());
    }
    if (!isConnected) {
      Promise.resolve().then(() => setUserPosition(null));
    }
  }, [isConnected, address]);

  // Pipeline fetch
  const [pipelineLogs, setPipelineLogs] = useState([]);
  const [aumHistory, setAumHistory] = useState([]);
  const [agentStatus, setAgentStatus] = useState('offline');

  const terminalBodyRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);

  const handleScroll = () => {
    const container = terminalBodyRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 15;
    shouldAutoScrollRef.current = isAtBottom;
  };

  useEffect(() => {
    const container = terminalBodyRef.current;
    if (!container) return;
    if (shouldAutoScrollRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [pipelineLogs, logs]);

  const checkAgentHealth = useCallback(async () => {
    const HEALTH_URL = PIPELINE_API ? `${PIPELINE_API}/health` : '/health';
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(HEALTH_URL, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        setAgentStatus('online');
      } else {
        setAgentStatus('offline');
      }
    } catch {
      setAgentStatus(prev => prev === 'online' ? 'offline' : 'waking');
    }
  }, []);

  const fetchPipelineState = useCallback(async () => {
    try {
      const res = await fetch(STATE_JSON_URL);
      if (!res.ok) return;
      const data = await res.json();
      setPipelineState(data);

      if (data.logs) {
        setPipelineLogs(data.logs.slice(-50));
      }

      if (data.aum_history && data.aum_history.length > 0) {
        setAumHistory(data.aum_history.map((h, i) => ({
          idx: i + 1,
          label: `#${i + 1}`,
          aum: h.aum,
          block: h.block,
          time: h.timestamp ? new Date(h.timestamp).toLocaleTimeString() : ''
        })));
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => {
      checkAgentHealth();
      fetchPipelineState();
    });
    const intervalHealth = setInterval(checkAgentHealth, 840000); // Ping every 14 minutes to keep Render active
    const intervalState = setInterval(fetchPipelineState, 15000);
    return () => {
      clearInterval(intervalHealth);
      clearInterval(intervalState);
    };
  }, [checkAgentHealth, fetchPipelineState]);

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
  const hasActivePools = (vaultConfig?.activePools?.length || 0) > 0;
  const daVerified = vaultConfig?.daVerificationEnabled;
  const pipelineLogsCount = pipelineState?.logs?.length || 0;
  const aumSnapshots = pipelineState?.aum_history?.length || 0;
  const hasPipelineData = !!(pipelineState?.latest_storage_root || pipelineState?.history?.length || pipelineState?.da_blob_hash);

  const pipelineSteps = [
    {
      label: '0G Storage',
      icon: Database,
      active: !!pipelineState?.latest_storage_root,
      detail: pipelineState?.latest_storage_root
        ? `Root: ${fmtAddr(pipelineState.latest_storage_root)}`
        : hasPipelineData ? 'Monitoring' : 'Awaiting first deposit'
    },
    {
      label: '0G Compute',
      icon: Cpu,
      active: !!pipelineState?.history?.length,
      detail: pipelineState?.history?.length
        ? `${pipelineState.history.length} TEE runs`
        : hasPipelineData ? 'Ready' : 'Awaiting first deposit'
    },
    {
      label: '0G DA',
      icon: Shield,
      active: !!pipelineState?.da_blob_hash,
      detail: pipelineState?.da_blob_hash
        ? `Blob: ${fmtAddr(pipelineState.da_blob_hash)}`
        : daVerified ? 'Verified — awaiting blob' : 'DA verification OFF'
    },
    {
      label: '0G Chain',
      icon: ArrowRightLeft,
      active: hasActivePools,
      detail: hasActivePools
        ? `${vaultConfig?.activePools?.length} pools active`
        : vaultAUM > 0 ? 'AUM detected — pending rebalance' : 'Awaiting first deposit'
    }
  ];

  // Loading state while deployments.json loads
  if (deploymentsLoading) {
    return (
      <div className="loading-screen">
        <Loader2 size={32} className="spin" />
        <p>Loading CogniVault...</p>
      </div>
    );
  }

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
          {agentStatus === 'online' && (
            <span className="header-net" style={{ color: 'var(--c-success)', border: '1px solid rgba(16, 185, 129, 0.15)', background: 'rgba(16, 185, 129, 0.08)', padding: '0.2rem 0.6rem', borderRadius: '12px', marginLeft: '0.5rem' }}>
              <span className="net-dot" style={{ background: 'var(--c-success)' }} /> AI Agent Online
            </span>
          )}
          {agentStatus === 'waking' && (
            <span className="header-net" style={{ color: 'var(--c-warn)', border: '1px solid rgba(245, 158, 11, 0.15)', background: 'rgba(245, 158, 11, 0.08)', padding: '0.2rem 0.6rem', borderRadius: '12px', marginLeft: '0.5rem' }}>
              <span className="net-dot" style={{ background: 'var(--c-warn)', animation: 'pulseDot 1s infinite' }} /> Waking AI Agent...
            </span>
          )}
          {agentStatus === 'offline' && (
            <span className="header-net" style={{ color: 'var(--c-error)', border: '1px solid rgba(239, 68, 68, 0.15)', background: 'rgba(239, 68, 68, 0.08)', padding: '0.2rem 0.6rem', borderRadius: '12px', marginLeft: '0.5rem' }}>
              <span className="net-dot" style={{ background: 'var(--c-error)', animation: 'none' }} /> AI Agent Offline
            </span>
          )}
        </div>
        <div className="app-header-right">
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
              <h3><TrendingUp size={18} /> Protocol Growth</h3>
              <span className="badge-live">{aumHistory.length} snapshots</span>
            </div>
            {aumHistory.length > 0 ? (
              <div className="chart-wrap">
                <ResponsiveContainer>
                  <AreaChart data={aumHistory} margin={{ top: 10, right: 5, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradAUM" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00f2fe" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#00f2fe" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={{ background: '#0d121f', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', fontSize: '0.8rem' }} labelStyle={{ color: '#94a3b8' }} formatter={v => [`$${Number(v).toFixed(2)}`, 'AUM']} />
                    <Area type="monotone" dataKey="aum" name="Vault AUM" stroke="#00f2fe" strokeWidth={2} fill="url(#gradAUM)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="chart-empty">
                <Activity size={28} />
                <p>Vault growth chart will appear after first deposit</p>
              </div>
            )}
            {aumHistory.length > 1 && (
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--t-secondary)' }}>
                <span>Boot: ${fmt(aumHistory[0]?.aum, 2)}</span>
                <span>Current: ${fmt(aumHistory[aumHistory.length - 1]?.aum, 2)}</span>
                <span style={{ color: 'var(--c-success)' }}>
                  Growth: +{fmt(((aumHistory[aumHistory.length - 1]?.aum - aumHistory[0]?.aum) / Math.max(aumHistory[0]?.aum, 1)) * 100, 2)}%
                </span>
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
              <div className="terminal-body" ref={terminalBodyRef} onScroll={handleScroll}>
                {pipelineLogs.length === 0 && logs.length === 0 && <div className="term-line muted">Waiting for pipeline activity...</div>}
                {pipelineLogs.map((log, i) => (
                  <div key={`p${i}`} className={`term-line term-${log.type}`}>
                    <span className="term-time">{log.time ? new Date(log.time).toLocaleTimeString() : ''}</span>
                    {log.text}
                  </div>
                ))}
                {logs.map(log => (
                  <div key={log.id} className={`term-line term-${log.type}`}>
                    <span className="term-time">{log.time}</span>
                    {log.text}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card card-pipeline">
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
            <div className="pipeline-latest">
              {latestRun ? (
                <>
                  <div className="pipeline-latest-row">
                    <span className="muted">Last Strategy</span>
                    <span className="mono">[{latestRun.allocations.join(', ')}] bps</span>
                  </div>
                  <div className="pipeline-latest-row">
                    <span className="muted">DA Root</span>
                    <span className="mono">{latestRun.da_data_root ? fmtAddr('0x' + latestRun.da_data_root) : 'N/A'}</span>
                  </div>
                </>
              ) : (
                <div className="pipeline-latest-row">
                  <span className="muted">Status</span>
                  <span>{vaultAUM > 0 ? 'AUM detected — pipeline will run on next cycle' : 'No deposits yet — pipeline waiting'}</span>
                </div>
              )}
              <div className="pipeline-latest-row">
                <span className="muted">TEE Runs</span>
                <span className="mono">{pipelineState?.history?.length || 0}</span>
              </div>
              <div className="pipeline-latest-row">
                <span className="muted">AUM Snapshots</span>
                <span className="mono">{aumSnapshots}</span>
              </div>
              <div className="pipeline-latest-row">
                <span className="muted">Activity Logs</span>
                <span className="mono">{pipelineLogsCount}</span>
              </div>
              <div className="pipeline-latest-row">
                <span className="muted">DA Verification</span>
                <span style={{ color: daVerified ? 'var(--c-success)' : 'var(--t-muted)' }}>{daVerified ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div className="pipeline-latest-row">
                <span className="muted">TEE Signer</span>
                <span className="mono">{vaultConfig ? fmtAddr(vaultConfig.teeSigner) : 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
