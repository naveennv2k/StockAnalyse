import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_API_DIR = path.join(__dirname, '..', '..', 'pythonAPI');

/**
 * Market Data Service — bridges Node.js to Python scripts
 */

export class MarketDataService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 15000; // 15 seconds
  }

  /**
   * Live quotes: Flattrade when the session is valid, Yahoo Finance otherwise.
   * Each record carries a `source` field.
   */
  async getQuotes(symbols) {
    const clean = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()))];
    if (!clean.length || clean.some((s) => !/^[A-Z0-9&_-]{1,20}$/.test(s))) return [];

    const cacheKey = `quotes:${[...clean].sort().join(',')}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const out = JSON.parse(await this._runScript('fetch_quotes.py', clean));
      this.flattradeError = out.flattrade_error;
      this._setCache(cacheKey, out.data);
      return out.data;
    } catch (err) {
      console.error('MarketData getQuotes error:', err.message);
      return [];
    }
  }

  /**
   * Analyze stocks using the Stock Monitor Agent
   */
  async analyzeStocks(symbols, interval = '5m', exchange = 'NSE', strictFlattrade = false) {
    const cleanSymbols = [...new Set((symbols || []).map((s) => String(s).trim().toUpperCase()))];
    if (!cleanSymbols.length || cleanSymbols.some((s) => !/^[A-Z0-9&_-]{1,20}$/.test(s))) return [];
    if (!['NSE', 'BSE'].includes(exchange)) return [];
    if (!['1m', '3m', '5m', '10m', '15m', '30m', '1h'].includes(interval)) return [];
    const script = `
import json, sys, math
sys.path.insert(0, '${PYTHON_API_DIR}')
from stock_data_provider import StockDataProvider, DataSource
from stock_monitor_agent import StockMonitorAgent
provider = StockDataProvider(source=DataSource.FLATTRADE if ${strictFlattrade ? 'True' : 'False'} else DataSource.AUTO)
agent = StockMonitorAgent(provider=provider)
results = agent.analyze_watchlist(${JSON.stringify(cleanSymbols)}, interval='${interval}', exchange='${exchange}')
for r in results:
    r['exchange'] = '${exchange}'
    for k, v in r.items():
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            r[k] = None
    for sig in r.get('signals', []):
        for k, v in sig.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                sig[k] = None
print(json.dumps(results))
`;

    try {
      const result = await this._runPython(script);
      return JSON.parse(result);
    } catch (err) {
      console.error('MarketData analyzeStocks error:', err.message);
      return [];
    }
  }

  /**
   * Get historical data for a symbol
   */
  async getHistorical(symbol, period = '1mo', interval = '1d') {
    const script = `
import json, sys, math
sys.path.insert(0, '${PYTHON_API_DIR}')
from stock_data_provider import StockDataProvider, DataSource
provider = StockDataProvider(source=DataSource.AUTO)
df = provider.get_historical('${symbol}', period='${period}', interval='${interval}')
if df.empty:
    print(json.dumps([]))
else:
    df = df.reset_index()
    for col in df.columns:
        cl = str(col).lower()
        if 'date' in cl or 'datetime' in cl:
            df[col] = df[col].astype(str).str[:10]
    records = df.where(df.notna(), None).to_dict(orient='records')
    for r in records:
        for k, v in r.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                r[k] = None
    print(json.dumps(records))
`;

    try {
      const result = await this._runPython(script);
      return JSON.parse(result);
    } catch (err) {
      console.error('MarketData getHistorical error:', err.message);
      return [];
    }
  }

  /**
   * OHLCV candles with epoch-second timestamps (supports intraday)
   */
  async getCandles(symbol, interval = '5m', exchange = 'NSE', strictFlattrade = false) {
    const periods = { '1m': '1d', '5m': '5d', '15m': '5d', '30m': '1mo', '1h': '1mo', '1d': '6mo' };
    if (!periods[interval]) throw new Error('Invalid interval');
    if (!/^[A-Za-z0-9&_-]{1,20}$/.test(symbol)) throw new Error('Invalid symbol');
    if (!['NSE', 'BSE'].includes(exchange)) throw new Error('Invalid exchange');

    const sourceMode = strictFlattrade ? 'flattrade' : 'auto';
    const cacheKey = `candles:${exchange}:${symbol}:${interval}:${sourceMode}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const script = `
import json, sys, math
sys.path.insert(0, '${PYTHON_API_DIR}')
from stock_data_provider import StockDataProvider, DataSource
provider = StockDataProvider(source=DataSource.FLATTRADE if ${strictFlattrade ? 'True' : 'False'} else DataSource.AUTO)
df = provider.get_historical('${symbol}', period='${periods[interval]}', interval='${interval}', exchange='${exchange}')
out = []
source = 'unknown'
if not df.empty:
  if 'source' in df.columns:
    source = str(df['source'].iloc[-1])
    for ts, r in df.iterrows():
        vals = [r.get('Open'), r.get('High'), r.get('Low'), r.get('Close')]
        if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in vals):
            continue
        vol = r.get('Volume')
        out.append({'time': int(ts.timestamp()), 'open': float(vals[0]), 'high': float(vals[1]),
                    'low': float(vals[2]), 'close': float(vals[3]),
                    'volume': 0 if vol is None or (isinstance(vol, float) and math.isnan(vol)) else float(vol)})
print(json.dumps({'data': out, 'source': source}))
`;

  const result = JSON.parse(await this._runPython(script));
  const response = { data: result.data || [], source: result.source || 'unknown' };
  this._setCache(cacheKey, response);
  return response;
  }

  /**
   * Scan the intraday universe; results cached 3 min and concurrent calls share one run
   */
  scanMarket(interval = '5m', minConfidence = 60, universe = 'nifty50', strictFlattrade = false) {
    if (!['1m', '5m', '15m', '30m', '1h'].includes(interval)) return Promise.reject(new Error('Invalid interval'));
    // Cache lifetime (minutes) grows with universe size since a scan takes longer.
    const ttlMin = { nifty50: 3, nifty100: 5, nifty200: 8, nifty500: 15 }[universe];
    if (!ttlMin) return Promise.reject(new Error('Invalid universe'));
    const conf = Number(minConfidence);
    if (!Number.isInteger(conf) || conf < 0 || conf > 100) return Promise.reject(new Error('Invalid minConfidence'));

    this.scans ??= new Map();
    // One scan serves every threshold >= 40; the requested threshold is applied on the way out.
    const runFloor = Math.min(conf, 40);
    const source = strictFlattrade ? 'flattrade' : 'auto';
    const key = `${universe}:${interval}:${source}:${runFloor}`;
    const withThreshold = (p) => p.then((d) => ({
      ...d,
      min_confidence: conf,
      buy: d.buy.filter((r) => r.confidence > conf),
      sell: d.sell.filter((r) => r.confidence > conf),
    }));
    const entry = this.scans.get(key);
    if (entry && (entry.promise || Date.now() - entry.time < ttlMin * 60000)) {
      return withThreshold(entry.promise || Promise.resolve(entry.data));
    }

    const promise = new Promise((resolve, reject) => {
      execFile('python3', ['scan_market.py', interval, String(runFloor), universe, source], {
        timeout: 20 * 60000,
        maxBuffer: 50 * 1024 * 1024,
        cwd: PYTHON_API_DIR,
      }, (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || error.message));
        try {
          resolve({ ...JSON.parse(stdout.trim().split('\n').pop()), interval, min_confidence: runFloor, updated_at: new Date().toISOString() });
        } catch (e) {
          reject(new Error('Scan returned invalid output'));
        }
      });
    }).then(
      (data) => { this.scans.set(key, { data, time: Date.now() }); return data; },
      (err) => {
        // Keep the last good result so a failed refresh doesn't discard it.
        if (entry?.data) this.scans.set(key, entry); else this.scans.delete(key);
        throw err;
      },
    );
    this.scans.set(key, { promise });
    return withThreshold(promise);
  }

  backtestWatchlist(symbols, candidateMinConfidence = 50, capital = 1000000, positionPct = 10) {
    const watchlist = [...new Map((symbols || []).map((item) => {
      const symbol = String(item?.symbol || '').trim().toUpperCase();
      const exchange = String(item?.exchange || 'NSE').trim().toUpperCase();
      if (!/^[A-Z0-9&_-]{1,20}$/.test(symbol) || !['NSE', 'BSE'].includes(exchange)) return null;
      return [`${exchange}:${symbol}`, { symbol, exchange }];
    }).filter(Boolean)).values()];
    if (!watchlist.length || watchlist.length > 100) return Promise.reject(new Error('Watchlist must contain 1 to 100 valid NSE/BSE symbols'));
    if (!Number.isInteger(Number(candidateMinConfidence)) || candidateMinConfidence < 0 || candidateMinConfidence > 100) {
      return Promise.reject(new Error('Invalid scanner confidence threshold'));
    }
    if (!Number.isFinite(Number(capital)) || capital <= 0 || !Number.isFinite(Number(positionPct)) || positionPct <= 0 || positionPct > 25) {
      return Promise.reject(new Error('Invalid backtest capital or position size'));
    }
    return new Promise((resolve, reject) => {
      execFile('python3', [
        'backtest_watchlist.py', JSON.stringify(watchlist), String(candidateMinConfidence), String(capital), String(positionPct),
      ], {
        timeout: 30 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: PYTHON_API_DIR,
      }, (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || error.message));
        try {
          const result = JSON.parse(stdout.trim().split('\n').pop());
          if (result.error) return reject(new Error(result.error));
          resolve(result);
        } catch {
          reject(new Error('Calibration replay returned invalid output'));
        }
      });
    });
  }

  // ── Internal helpers ──

  /** Live Flattrade session check (cached 30s). */
  async getFlattradeStatus() {
    if (this._ftStatus && Date.now() - this._ftStatus.time < 30000) return this._ftStatus.data;
    const data = JSON.parse(await this._runScript('fetch_quotes.py', ['--status']));
    this._ftStatus = { data, time: Date.now() };
    return data;
  }

  /** Drop cached session status and quotes after a new token is stored. */
  resetFlattradeCache() {
    this._ftStatus = null;
    this._ftAccount = null;
    this.scans?.clear();
    this.cache.clear();
  }

  /** Real-money Flattrade account snapshot (read-only, cached 15s). */
  async getFlattradeAccount() {
    if (this._ftAccount && Date.now() - this._ftAccount.time < 15000) return this._ftAccount.data;
    const data = JSON.parse(await this._runScript('fetch_quotes.py', ['--account']));
    this._ftAccount = { data, time: Date.now() };
    return data;
  }

  _runScript(file, args) {
    return new Promise((resolve, reject) => {
      execFile('python3', [file, ...args], {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: PYTHON_API_DIR,
      }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout.trim().split('\n').pop());
      });
    });
  }

  _runPython(script) {
    return new Promise((resolve, reject) => {
      const proc = execFile('python3', ['-c', script], {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: PYTHON_API_DIR,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  _getFromCache(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.time < this.cacheTimeout) {
      return entry.data;
    }
    this.cache.delete(key);
    return null;
  }

  _setCache(key, data) {
    this.cache.set(key, { data, time: Date.now() });
  }
}

export default MarketDataService;
