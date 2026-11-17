import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { RefreshCw, Brain, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { getWatchlist, getCandles, analyzeStocks, getNews, scanMarket, searchSymbols } from '../services/api';
import { useLiveTicks } from '../hooks/useLiveTicks';

const INTERVAL_SEC = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800 };
const istTime = (time) => {
  const date = typeof time === 'number'
    ? new Date(time * 1000)
    : new Date(Date.UTC(time.year, time.month - 1, time.day));
  const options = typeof time === 'number'
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { day: '2-digit', month: 'short' };
  return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'Asia/Kolkata' }).format(date);
};

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '1d'];
const CANDLE_REFRESH_MS = 15000;
const AI_REFRESH_MS = 60000;
const NEWS_REFRESH_MS = 5 * 60000;
const SCAN_FLOOR = 40; // the server scans once at this floor; the confidence box filters locally
const SCAN_INTERVAL = '5m'; // independent of the chart's interval buttons
const SCAN_UNIVERSES = {
  nifty50: { label: 'Nifty 50', refreshMin: 3, hint: '~20s' },
  nifty100: { label: 'Nifty 100', refreshMin: 5, hint: '~30s' },
  nifty200: { label: 'Nifty 200', refreshMin: 8, hint: '~1 min' },
  nifty500: { label: 'Nifty 500', refreshMin: 15, hint: '~1.5 min' },
};
const fmt = (v) => v != null ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

const verdictStyle = {
  BUY: { cls: 'bg-green-100 text-green-700 border-green-200', Icon: TrendingUp },
  SELL: { cls: 'bg-red-100 text-red-700 border-red-200', Icon: TrendingDown },
  HOLD: { cls: 'bg-amber-100 text-amber-700 border-amber-200', Icon: Minus },
};

export default function LiveChart() {
  const [symbols, setSymbols] = useState([]);
  const [symbol, setSymbol] = useState('');
  const [interval, setIntervalValue] = useState('5m');
  const [advice, setAdvice] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [candleSource, setCandleSource] = useState(null);
  const [news, setNews] = useState(null);
  const [scan, setScan] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState(null);
  const scanSeq = useRef(0);
  const [minConf, setMinConf] = useState(60);
  const [universe, setUniverse] = useState('nifty50');

  const containerRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const lastCandleRef = useRef(null); // { symbol, interval, candle } for the newest bar on the chart
  const { ticks, status: feed } = useLiveTicks(symbol ? [symbol] : []);
  const tick = ticks[symbol];

  useEffect(() => {
    getWatchlist()
      .then((res) => {
        const list = (res.watchlist || []).map((w) => w.symbol);
        setSymbols(list);
        if (list.length) setSymbol((s) => s || list[0]);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Chart setup
  useEffect(() => {
    const chart = createChart(containerRef.current, {
      autoSize: true,
      localization: { locale: 'en-IN', timeFormatter: istTime },
      layout: { background: { color: '#ffffff' }, textColor: '#475569' },
      grid: { vertLines: { color: '#f1f5f9' }, horzLines: { color: '#f1f5f9' } },
      timeScale: { timeVisible: true, secondsVisible: false, tickMarkFormatter: istTime },
    });
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#16a34a', downColor: '#dc2626', borderVisible: false,
      wickUpColor: '#16a34a', wickDownColor: '#dc2626',
    });
    volumeRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' });
    volumeRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    return () => chart.remove();
  }, []);

  const loadCandles = useCallback(async () => {
    if (!symbol) return;
    try {
      const res = await getCandles(symbol, interval);
      const data = res.data || [];
      setCandleSource(res.source || 'unknown');
      candleRef.current.setData(data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      volumeRef.current.setData(data.map((c) => ({
        time: c.time, value: c.volume, color: c.close >= c.open ? '#86efac' : '#fca5a5',
      })));
      const newest = data.length ? (({ time, open, high, low, close }) => ({ time, open, high, low, close }))(data[data.length - 1]) : null;
      const prev = lastCandleRef.current;
      // A refresh replaces the series; keep the live bar if it is as new as the fetched data.
      if (prev && prev.symbol === symbol && prev.interval === interval && newest && prev.candle.time >= newest.time) {
        candleRef.current.update(prev.candle);
      } else {
        lastCandleRef.current = newest ? { symbol, interval, candle: newest } : null;
      }
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [symbol, interval]);

  const loadAdvice = useCallback(async () => {
    if (!symbol) return;
    setAiLoading(true);
    try {
      const res = await analyzeStocks([symbol], interval === '1d' ? '15m' : interval);
      setAdvice(res.results?.[0] || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setAiLoading(false);
    }
  }, [symbol, interval]);

  useEffect(() => {
    loadCandles();
    const id = setInterval(loadCandles, CANDLE_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadCandles]);

  useEffect(() => {
    // Keep the previous analysis on screen (dimmed) while the new one loads, so the page height doesn't jump.
    loadAdvice();
    const id = setInterval(loadAdvice, AI_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadAdvice]);

  useEffect(() => {
    if (!symbol) return;
    const load = () => getNews(symbol).then(setNews).catch(() => setNews({ items: [], label: 'UNAVAILABLE' }));
    load();
    const id = setInterval(load, NEWS_REFRESH_MS);
    return () => clearInterval(id);
  }, [symbol]);

  useEffect(() => {
    // Fold each streamed tick into the newest bar (1h/1d bars don't line up with exchange sessions, so they only show the price).
    const lc = lastCandleRef.current;
    const step = INTERVAL_SEC[interval];
    if (!tick || !step || !candleRef.current || tick.symbol !== symbol || !tick.ltp) return;
    if (!lc || lc.symbol !== symbol || lc.interval !== interval) return;
    const nowSec = Math.floor(tick.t / 1000);
    const last = lc.candle;
    if (nowSec < last.time) return;
    const price = tick.ltp;
    const bar = nowSec >= last.time + step
      ? { time: last.time + Math.floor((nowSec - last.time) / step) * step, open: price, high: price, low: price, close: price }
      : { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
    candleRef.current.update(bar);
    lc.candle = bar;
  }, [tick, symbol, interval]);

  const scanKey = `scan:${universe}:${SCAN_INTERVAL}`;

  const loadScan = useCallback(async () => {
    const seq = ++scanSeq.current;
    setScanLoading(true);
    try {
      const res = await scanMarket(SCAN_INTERVAL, SCAN_FLOOR, universe);
      if (seq !== scanSeq.current) return; // a newer request or a universe change superseded this one
      setScan(res);
      setScanError(null);
      try { localStorage.setItem(scanKey, JSON.stringify(res)); } catch { /* storage full or unavailable */ }
    } catch (e) {
      if (seq === scanSeq.current) setScanError(e.message); // keep showing the last results
    } finally {
      if (seq === scanSeq.current) setScanLoading(false);
    }
  }, [universe, scanKey]);

  useEffect(() => {
    // Show the last saved result immediately, then refresh in the background when it is due.
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(scanKey)); } catch { /* ignore corrupt cache */ }
    setScan(cached);
    setScanError(null);
    setScanLoading(false);
    const refreshMs = SCAN_UNIVERSES[universe].refreshMin * 60000;
    const age = cached?.updated_at ? Date.now() - Date.parse(cached.updated_at) : Infinity;
    const first = setTimeout(loadScan, Math.max(0, refreshMs - age));
    const id = setInterval(loadScan, refreshMs);
    return () => { clearTimeout(first); clearInterval(id); scanSeq.current++; };
  }, [scanKey, universe, loadScan]);

  const threshold = Math.max(minConf, SCAN_FLOOR);
  const scanView = useMemo(() => scan && {
    ...scan,
    buy: (scan.buy || []).filter((r) => r.confidence > threshold),
    sell: (scan.sell || []).filter((r) => r.confidence > threshold),
  }, [scan, threshold]);

  const v = advice && !advice.error ? verdictStyle[advice.verdict] || verdictStyle.HOLD : null;
  const adviceStale = !!advice && (advice.symbol !== symbol || aiLoading);

  return (
    <div className="space-y-3">
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{error}</div>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart panel */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <SymbolSearch value={symbol} watchlist={symbols} onSelect={setSymbol} />
            <div className="flex rounded-lg border border-slate-300 overflow-hidden">
              {INTERVALS.map((i) => (
                <button
                  key={i} onClick={() => setIntervalValue(i)}
                  className={`px-3 py-1.5 text-sm ${i === interval ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {i}
                </button>
              ))}
            </div>
            <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
              {tick?.ltp != null && (
                <span className="text-sm font-semibold text-slate-800">
                  ₹{fmt(tick.ltp)}
                  {tick.change_pct != null && (
                    <span className={`ml-1.5 text-xs ${tick.change_pct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {tick.change_pct >= 0 ? '+' : ''}{fmt(tick.change_pct)}%
                    </span>
                  )}
                </span>
              )}
              <span className="flex items-center gap-1.5" title={feed.error || ''}>
                <span className={`w-2 h-2 rounded-full ${feed.connected ? 'bg-green-500 animate-pulse' : 'bg-amber-400'}`} />
                {feed.connected ? `Flattrade stream · ${candleSource || 'loading candles'}` : `${candleSource === 'flattrade' ? 'Flattrade' : 'Fallback'} polling${lastUpdate ? ` · ${lastUpdate.toLocaleTimeString()}` : ''}`}
              </span>
            </span>
          </div>
          <div ref={containerRef} className="h-[460px] w-full" />
          {!symbols.length && <p className="text-sm text-slate-500 mt-2">Add symbols to your watchlist on the Dashboard to chart them.</p>}
        </div>

        {/* AI suggestion panel */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 lg:min-h-[560px]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2"><Brain size={18} className="text-purple-600" /> AI Suggestion</h2>
            <button onClick={loadAdvice} className="text-slate-400 hover:text-slate-600 p-1"><RefreshCw size={16} className={aiLoading ? 'animate-spin' : ''} /></button>
          </div>

          {!advice && <p className="text-sm text-slate-500">{aiLoading ? 'Analyzing...' : 'No analysis yet.'}</p>}
          {advice?.error && <p className="text-sm text-red-600">{advice.summary}</p>}

          {v && (
            <div className={`space-y-4 transition-opacity ${adviceStale ? 'opacity-50' : ''}`}>
              <div className={`flex items-center justify-between border rounded-lg px-3 py-2 ${v.cls}`}>
                <span className="flex items-center gap-2 font-bold"><v.Icon size={18} /> {advice.verdict}</span>
                <span className="text-sm">{advice.confidence}% confidence</span>
              </div>
              <p className="text-sm text-slate-600">{advice.summary}</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Metric label="LTP" value={`₹${fmt(advice.ltp)}`} />
                <Metric label="Risk" value={advice.risk_level} />
                <Metric label="Entry" value={`${fmt(advice.entry_low)} - ${fmt(advice.entry_high)}`} />
                <Metric label="VWAP" value={fmt(advice.vwap)} />
                <Metric label="Target" value={`${fmt(advice.target)} (${advice.target_pct}%)`} cls="text-green-600" />
                <Metric label="Stop Loss" value={`${fmt(advice.stop_loss)} (${advice.sl_pct}%)`} cls="text-red-600" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Indicators</h3>
                <ul className="space-y-1">
                  {(advice.signals || []).map((s, idx) => (
                    <li key={idx} title={s.note} className="flex items-center justify-between text-xs">
                      <span className="text-slate-700">{s.name}</span>
                      <span className={s.signal === 'BUY' ? 'text-green-600 font-medium' : s.signal === 'SELL' ? 'text-red-600 font-medium' : 'text-slate-500'}>{s.signal}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <NewsList news={news} />
            </div>
          )}
        </div>
      </div>

      <Scanner scan={scanView} loading={scanLoading} error={scanError} minConf={minConf} onMinConf={setMinConf} universe={universe} onUniverse={setUniverse} onRefresh={loadScan} onPick={setSymbol} active={symbol} />
    </div>
  );
}

function SymbolSearch({ value, watchlist, onSelect }) {
  const [text, setText] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const boxRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => { if (!open) setText(value || ''); }, [value, open]);

  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const q = text.trim();
    const mine = ++seq.current;
    // Untouched or empty box: offer the watchlist; otherwise search all NSE stocks.
    if (!q || q === value) {
      setResults(watchlist.map((s) => ({ symbol: s, name: 'Watchlist' })));
      setActive(0);
      setErr(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchSymbols(q);
        if (mine !== seq.current) return;
        setResults(r.results || []);
        setActive(0);
        setErr(null);
      } catch (e) {
        if (mine === seq.current) setErr(e.message);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [text, open, value, watchlist]);

  const pick = (sym) => {
    onSelect(sym);
    setText(sym);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const typed = text.trim().toUpperCase();
      if (results[active]) pick(results[active].symbol);
      else if (/^[A-Z0-9&_-]{1,20}$/.test(typed)) pick(typed);
    }
  };

  return (
    <div ref={boxRef} className="relative w-64">
      <input
        type="text" role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off" spellCheck="false"
        value={text} placeholder="Search stock or company..."
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onKeyDown={onKeyDown}
        className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium"
      />
      {open && (
        <ul role="listbox" className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {results.map((r, i) => (
            <li key={r.symbol} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(r.symbol); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-1.5 text-sm cursor-pointer ${i === active ? 'bg-blue-50' : ''}`}>
              <span className="font-semibold text-slate-800">{r.symbol}</span>
              {r.series && r.series !== 'EQ' && <span className="ml-1.5 text-[10px] text-amber-600">{r.series}</span>}
              <span className="block text-xs text-slate-500 truncate">{r.name}</span>
            </li>
          ))}
          {loading && <li className="px-3 py-2 text-xs text-slate-400">Searching...</li>}
          {!loading && err && <li className="px-3 py-2 text-xs text-red-600">{err}</li>}
          {!loading && !err && results.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">No matching stock</li>}
        </ul>
      )}
    </div>
  );
}

const Scanner = memo(function Scanner({ scan, loading, error, minConf, onMinConf, universe, onUniverse, onRefresh, onPick, active }) {
  const u = SCAN_UNIVERSES[universe];
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h2 className="font-semibold text-slate-800">Intraday Scanner</h2>
        <select value={universe} onChange={(e) => onUniverse(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm">
          {Object.entries(SCAN_UNIVERSES).map(([id, x]) => <option key={id} value={id}>{x.label} (scan {x.hint})</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          Confidence &gt;
          <input
            type="number" min={SCAN_FLOOR} max="99" value={minConf}
            onChange={(e) => { const n = parseInt(e.target.value, 10); if (n >= 0 && n <= 100) onMinConf(n); }}
            onBlur={() => onMinConf(Math.max(minConf, SCAN_FLOOR))}
            title={`Minimum ${SCAN_FLOOR}`}
            className="w-16 border border-slate-300 rounded-lg px-2 py-1 text-sm"
          />
        </label>
        <button onClick={onRefresh} className="text-slate-400 hover:text-slate-600 p-1"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        <span className="ml-auto text-xs text-slate-500">
          {scan ? `${scan.scanned} analyzed of ${scan.tradable_on_flattrade ?? scan.scanned}${scan.flattrade_checked ? ' Flattrade-listed' : ''}${scan.failed ? `, ${scan.failed} failed` : ''} · ${new Date(scan.updated_at).toLocaleTimeString()} · auto-refresh ${u.refreshMin} min` : loading ? `Scanning ${u.label} (can take ${u.hint})...` : ''}
        </span>
      </div>
      {error && <p className="text-xs text-amber-600 mb-2">Scan refresh failed ({error}). Showing the last results.</p>}
      {scan && !scan.flattrade_checked && (
        <p className="text-xs text-amber-600 mb-2">Flattrade not connected: showing the {u.label} list without the broker listing check.</p>
      )}
      {scan?.flattrade_checked && (
        <p className="text-xs text-slate-400 mb-2">Only NSE EQ-series stocks listed on Flattrade are scanned. Flattrade's API doesn't expose per-stock intraday (MIS) permission, so the broker may still reject a few.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PickList title="BUY" color="green" rows={scan?.buy} loading={loading && !scan} onPick={onPick} active={active} />
        <PickList title="SELL" color="red" rows={scan?.sell} loading={loading && !scan} onPick={onPick} active={active} />
      </div>
    </div>
  );
});

function PickList({ title, color, rows, loading, onPick, active }) {
  const text = color === 'green' ? 'text-green-700' : 'text-red-700';
  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase mb-1.5 ${text}`}>{title} ({rows?.length ?? 0})</h3>
      <ul className="space-y-1 max-h-64 overflow-y-auto">
        {(rows || []).map((r) => (
          <li key={r.symbol}>
            <button
              onClick={() => onPick(r.symbol)}
              className={`w-full flex items-center justify-between text-sm px-3 py-1.5 rounded-lg border hover:bg-slate-50 ${r.symbol === active ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}
            >
              <span className="font-medium text-slate-800">{r.symbol}</span>
              <span className="text-xs text-slate-500">₹{fmt(r.ltp)}</span>
              <span className={`font-semibold ${text}`}>{r.confidence}%</span>
            </button>
          </li>
        ))}
        {rows && !rows.length && <li className="text-xs text-slate-400">None above threshold.</li>}
        {loading && <li className="text-xs text-slate-400">Scanning...</li>}
      </ul>
    </div>
  );
}

const newsColor = { POSITIVE: 'text-green-600', NEGATIVE: 'text-red-600', NEUTRAL: 'text-slate-500' };

function NewsList({ news }) {
  if (!news) return <p className="text-xs text-slate-400">Loading news...</p>;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-xs font-semibold text-slate-500 uppercase">News</h3>
        <span className={`text-xs font-medium ${newsColor[news.label] || 'text-slate-500'}`}>
          {news.label}{news.score != null && ` (${news.score})`}
        </span>
      </div>
      <ul className="space-y-1.5 max-h-48 overflow-y-auto">
        {news.items.map((n, i) => (
          <li key={i} className="text-xs">
            <a href={n.link} target="_blank" rel="noreferrer noopener" className="text-slate-700 hover:text-blue-600">
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${n.sentiment > 0 ? 'bg-green-500' : n.sentiment < 0 ? 'bg-red-500' : 'bg-slate-300'}`} />
              {n.title}
            </a>
          </li>
        ))}
        {!news.items.length && <li className="text-xs text-slate-400">No recent news.</li>}
      </ul>
    </div>
  );
}

function Metric({ label, value, cls = 'text-slate-800' }) {
  return (
    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
      <div className={`font-medium ${cls}`}>{value}</div>
    </div>
  );
}
