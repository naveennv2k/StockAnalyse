import { useState, useEffect, useCallback, useRef } from 'react';
import { getDashboard, getQuotes, addToWatchlist, removeFromWatchlist, analyzeStocks, placeOrder, searchSymbols } from '../services/api';
import { useLiveTicks } from '../hooks/useLiveTicks';
import { TrendingUp, TrendingDown, RefreshCw, Plus, X, Brain, IndianRupee, BarChart3, Target } from 'lucide-react';

const fmt = (v) => v != null ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
const fmtInt = (v) => v != null ? Number(v).toLocaleString('en-IN') : '-';

export default function Dashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [ftError, setFtError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [newSymbol, setNewSymbol] = useState('');
  const [symbolSuggestions, setSymbolSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [searchingSymbols, setSearchingSymbols] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const orderInFlight = useRef(false);
  const searchRequest = useRef(0);
  const { ticks } = useLiveTicks((dashboard?.watchlist || []).map((w) => w.symbol));

  const fetchData = useCallback(async () => {
    try {
      const data = await getDashboard();
      setDashboard(data);

      if (data.watchlist?.length) {
        const symbols = data.watchlist.map(w => w.symbol);
        const q = await getQuotes(symbols);
        setQuotes(q.data || []);
        setFtError(q.flattrade_error || null);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const query = newSymbol.trim();
    const requestId = ++searchRequest.current;
    if (query.length < 2) {
      setSymbolSuggestions([]);
      setSuggestionsOpen(false);
      setSearchingSymbols(false);
      return undefined;
    }

    const timer = setTimeout(async () => {
      setSearchingSymbols(true);
      try {
        const result = await searchSymbols(query);
        if (requestId !== searchRequest.current) return;
        const watched = new Set((dashboard?.watchlist || []).map((item) => item.symbol));
        setSymbolSuggestions((result.results || []).filter((item) => !watched.has(item.symbol)));
        setActiveSuggestion(0);
        setSuggestionsOpen(true);
      } catch {
        if (requestId === searchRequest.current) setSymbolSuggestions([]);
      } finally {
        if (requestId === searchRequest.current) setSearchingSymbols(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [newSymbol, dashboard?.watchlist]);

  const handleAddSymbol = async (value = newSymbol) => {
    if (!value.trim()) return;
    await addToWatchlist(value.trim().toUpperCase());
    setNewSymbol('');
    setSymbolSuggestions([]);
    setSuggestionsOpen(false);
    fetchData();
  };

  const selectSuggestion = (symbol) => {
    setNewSymbol(symbol);
    setSymbolSuggestions([]);
    setSuggestionsOpen(false);
  };

  const handleRemoveSymbol = async (symbol) => {
    await removeFromWatchlist(symbol);
    fetchData();
  };

  const handleAnalyze = async () => {
    if (!dashboard?.watchlist?.length) return;
    setAnalyzing(true);
    try {
      const symbols = dashboard.watchlist.map(w => w.symbol);
      const res = await analyzeStocks(symbols, '5m');
      setAnalysis(res.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleQuickOrder = async (symbol, side, price, exchange = 'NSE') => {
    if (orderInFlight.current) return;
    const qty = prompt(`${side} ${symbol}\nEnter quantity:`, '1');
    if (qty == null) return;
    const quantity = Number(qty);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      alert('Quantity must be a positive whole number.');
      return;
    }
    const live = dashboard?.wallet?.trading_mode === 'live';
    if (live && !window.confirm(`LIVE ORDER: Submit a MARKET ${side} order for ${quantity} ${symbol} on ${exchange} as MIS?\n\nThis sends a real order to Flattrade and may execute immediately. The displayed price is only a reference, not a guaranteed fill price.`)) return;
    orderInFlight.current = true;
    try {
      const res = await placeOrder({ symbol, side, quantity, price, exchange, orderType: 'MARKET', productType: 'MIS', ...(live ? { liveConfirmed: true } : {}) });
      if (res.success) {
        alert(live
          ? `Flattrade accepted order ${res.order_number}: ${side} ${quantity} ${res.symbol}. Check the broker order book for fill status.`
          : `${side} order placed: ${quantity}x ${symbol} @ ₹${price}`);
        fetchData();
      } else {
        alert(`❌ ${res.error}`);
      }
    } catch (err) {
      alert(`❌ ${err.message}`);
    } finally {
      orderInFlight.current = false;
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-blue-500" size={32} /></div>;

  const wallet = dashboard?.wallet || {};
  const positions = dashboard?.positions || [];

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{error}</div>}

      {/* Stats Cards */}
      {wallet.trading_mode === 'live' ? (
        <div>
          <p className="text-xs font-semibold text-red-600 mb-2">LIVE MODE — manual Flattrade market orders require confirmation. AI auto-trading remains disabled in live mode.</p>
          {dashboard.live_account?.account ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={BarChart3} label="Cash Balance" value={`₹${fmt(dashboard.live_account.account.cash)}`} color="green" />
              <StatCard icon={IndianRupee} label="Margin Used" value={`₹${fmt(dashboard.live_account.account.margin_used)}`} color="blue" />
              <StatCard icon={Target} label="Open Positions" value={dashboard.live_account.account.positions.length} color="purple" />
              <StatCard icon={TrendingUp} label="Holdings" value={dashboard.live_account.account.holdings.length} color="green" />
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-700 text-sm">
              Flattrade account unavailable: {dashboard.live_account?.error || 'not connected'}. Authenticate on the Integrations page.
            </div>
          )}
        </div>
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={IndianRupee} label="Total Value" value={`₹${fmt(wallet.total_value)}`} color="blue" />
        <StatCard icon={BarChart3} label="Cash Balance" value={`₹${fmt(wallet.cash_balance)}`} color="green" />
        <StatCard icon={TrendingUp} label="Unrealized P&L" value={`₹${fmt(wallet.unrealized_pnl)}`}
          color={wallet.unrealized_pnl >= 0 ? 'green' : 'red'} />
        <StatCard icon={Target} label="Positions" value={positions.length} color="purple" />
      </div>
      )}

      {/* Watchlist + Add Symbol */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">📊 Watchlist</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text" value={newSymbol} role="combobox" aria-autocomplete="list"
                aria-expanded={suggestionsOpen && symbolSuggestions.length > 0}
                aria-controls="watchlist-symbol-suggestions"
                onFocus={() => symbolSuggestions.length && setSuggestionsOpen(true)}
                onChange={(e) => { setNewSymbol(e.target.value); setSuggestionsOpen(true); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' && symbolSuggestions.length) {
                    e.preventDefault();
                    setSuggestionsOpen(true);
                    setActiveSuggestion((index) => (index + 1) % symbolSuggestions.length);
                  } else if (e.key === 'ArrowUp' && symbolSuggestions.length) {
                    e.preventDefault();
                    setActiveSuggestion((index) => (index - 1 + symbolSuggestions.length) % symbolSuggestions.length);
                  } else if (e.key === 'Escape') {
                    setSuggestionsOpen(false);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (suggestionsOpen && symbolSuggestions[activeSuggestion]) selectSuggestion(symbolSuggestions[activeSuggestion].symbol);
                    else handleAddSymbol();
                  }
                }}
                placeholder="Search stocks..." className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-44"
              />
              {suggestionsOpen && newSymbol.trim().length >= 2 && (
                <div id="watchlist-symbol-suggestions" role="listbox" className="absolute z-20 top-full mt-1 left-0 w-72 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {searchingSymbols && <div className="px-3 py-2 text-xs text-slate-400">Searching...</div>}
                  {!searchingSymbols && symbolSuggestions.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No matching stocks</div>}
                  {symbolSuggestions.map((item, index) => (
                    <button key={`${item.symbol}-${item.series}`} type="button" role="option" aria-selected={index === activeSuggestion}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActiveSuggestion(index)}
                      onClick={() => selectSuggestion(item.symbol)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${index === activeSuggestion ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800">{item.symbol}</span>
                        <span className="block truncate text-xs text-slate-500">{item.name}</span>
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{item.series}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => handleAddSymbol()} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-sm flex items-center gap-1">
              <Plus size={14} /> Add
            </button>
            <button onClick={fetchData} className="text-slate-400 hover:text-slate-600 p-1.5"><RefreshCw size={16} /></button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {ftError && <p className="px-4 py-2 text-xs text-amber-600 bg-amber-50">Flattrade not used: {ftError}</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase">
                <th className="px-4 py-2.5">Symbol</th>
                <th className="px-4 py-2.5 text-right">LTP</th>
                <th className="px-4 py-2.5 text-right">Change</th>
                <th className="px-4 py-2.5 text-right">Open</th>
                <th className="px-4 py-2.5 text-right">High</th>
                <th className="px-4 py-2.5 text-right">Low</th>
                <th className="px-4 py-2.5 text-right">Volume</th>
                <th className="px-4 py-2.5 text-center">Trade</th>
                <th className="px-4 py-2.5 text-center">✕</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q0, i) => {
                // A streamed tick overrides the polled quote for the same symbol.
                const lt = ticks[String(q0.symbol).replace(/-EQ$/, '')];
                const q = lt?.ltp != null ? {
                  ...q0, live: true, source: 'flattrade', ltp: lt.ltp, change_pct: lt.change_pct ?? q0.change_pct,
                  change_abs: lt.prev_close ? lt.ltp - lt.prev_close : q0.change_abs,
                  open: lt.open ?? q0.open, high: lt.high ?? q0.high, low: lt.low ?? q0.low, volume: lt.volume ?? q0.volume,
                } : q0;
                const chg = q.change_abs;
                const isUp = chg > 0;
                const isDown = chg < 0;
                const color = isUp ? 'text-green-600' : isDown ? 'text-red-600' : 'text-slate-600';
                return (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                    <td className="px-4 py-2.5 font-semibold text-slate-800">
                      {q.symbol}
                      <span className={`ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded ${q.source === 'flattrade' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {q.live ? 'Flattrade · live' : q.source === 'flattrade' ? 'Flattrade' : 'Yahoo (delayed)'}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono font-bold ${color}`}>₹{fmt(q.ltp)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${isUp ? 'bg-green-100 text-green-700' : isDown ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                        {q.change_pct != null ? `${q.change_pct > 0 ? '+' : ''}${fmt(q.change_pct)}%` : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-500">₹{fmt(q.open)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-500">₹{fmt(q.high)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-500">₹{fmt(q.low)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-400">{fmtInt(q.volume)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => handleQuickOrder(q.symbol?.replace('-EQ',''), 'BUY', q.ltp, q.exchange || 'NSE')}
                          className="bg-green-100 hover:bg-green-200 text-green-700 text-xs font-bold px-2 py-1 rounded">B</button>
                        <button onClick={() => handleQuickOrder(q.symbol?.replace('-EQ',''), 'SELL', q.ltp, q.exchange || 'NSE')}
                          className="bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold px-2 py-1 rounded">S</button>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button onClick={() => handleRemoveSymbol(q.symbol?.replace('-EQ',''))} className="text-slate-300 hover:text-red-500">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {quotes.length === 0 && (
                <tr><td colSpan={9} className="text-center py-8 text-slate-400">No quotes loaded. Add symbols to your watchlist.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent Analysis */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800">🧠 Agent Analysis</h2>
            <p className="text-xs text-slate-400">Technical indicator-based BUY/SELL/HOLD recommendations</p>
          </div>
          <button onClick={handleAnalyze} disabled={analyzing}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
            <Brain size={16} className={analyzing ? 'animate-pulse' : ''} />
            {analyzing ? 'Analyzing...' : 'Analyze Watchlist'}
          </button>
        </div>

        <div className="p-4">
          {!analysis ? (
            <p className="text-center text-slate-400 py-8 text-sm">Click "Analyze Watchlist" to get recommendations</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {analysis.map((r, i) => (
                <AnalysisCard key={i} result={r} onOrder={handleQuickOrder} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color] || colors.blue}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} />
        <span className="text-xs font-medium opacity-75">{label}</span>
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function AnalysisCard({ result: r, onOrder }) {
  const v = r.verdict;
  const bg = v === 'BUY' ? 'bg-green-50 border-green-200' : v === 'SELL' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200';
  const badge = v === 'BUY' ? 'bg-green-500' : v === 'SELL' ? 'bg-red-500' : 'bg-yellow-500';

  if (r.error && r.confidence === 0) {
    return <div className="border border-slate-200 rounded-lg p-3 text-sm text-slate-400">{r.symbol}: {r.error}</div>;
  }

  return (
    <div className={`border rounded-xl p-4 ${bg}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">{r.symbol}</span>
          <span className="font-mono text-sm text-slate-500">₹{fmt(r.ltp)}</span>
        </div>
        <span className={`${badge} text-white text-xs font-bold px-2.5 py-1 rounded-full`}>{v}</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 bg-slate-200 rounded-full h-2">
          <div className={`${badge} h-2 rounded-full`} style={{ width: `${Math.min(100, r.confidence)}%` }} />
        </div>
        <span className="text-xs font-bold text-slate-600">{r.confidence}%</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs mb-2">
        <div className="bg-white/60 rounded p-1.5 text-center">
          <div className="text-slate-400">Target</div>
          <div className="font-mono font-bold text-green-700">₹{fmt(r.target)}</div>
        </div>
        <div className="bg-white/60 rounded p-1.5 text-center">
          <div className="text-slate-400">Stop Loss</div>
          <div className="font-mono font-bold text-red-700">₹{fmt(r.stop_loss)}</div>
        </div>
        <div className="bg-white/60 rounded p-1.5 text-center">
          <div className="text-slate-400">Risk</div>
          <div className="font-bold">{r.risk_level}</div>
        </div>
      </div>
      <details className="text-xs">
        <summary className="text-slate-500 cursor-pointer hover:text-slate-700">Indicators ({(r.signals||[]).filter(s=>s.signal==='BUY').length}↑ {(r.signals||[]).filter(s=>s.signal==='SELL').length}↓)</summary>
        <div className="mt-1 space-y-0.5">
          {(r.signals||[]).map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <span>{s.icon}</span>
              <span className="text-slate-500 w-20">{s.name}</span>
              <span className={s.signal === 'BUY' ? 'text-green-600 font-bold' : s.signal === 'SELL' ? 'text-red-600 font-bold' : 'text-slate-400'}>{s.signal}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
