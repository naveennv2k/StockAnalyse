import { Router } from 'express';
import { DemoWallet } from '../services/demoWallet.js';
import { MarketDataService } from '../services/marketData.js';
import { NewsService } from '../services/newsService.js';
import { GeminiService, PROVIDERS } from '../services/geminiService.js';
import { AutoTrader } from '../services/autoTrader.js';
import { FlattradeAuth } from '../services/flattradeAuth.js';
import { FlattradeOrders } from '../services/flattradeOrders.js';
import { SymbolSearch } from '../services/symbolSearch.js';
import { listTradingSkills } from '../services/tradingSkills.js';

const router = Router();
const wallet = new DemoWallet();
const marketData = new MarketDataService();
const newsService = new NewsService();
const gemini = new GeminiService();
const flattradeOrders = new FlattradeOrders();
const autoTrader = new AutoTrader({ wallet, marketData, newsService, gemini, flattradeOrders });
autoTrader.start();
export const attachLiveFeed = (liveFeed) => autoTrader.setLiveFeed(liveFeed);
const flattradeAuth = new FlattradeAuth(wallet.db);
const symbolSearch = new SymbolSearch();

// GET /api/symbols/search?q= — NSE stock autocomplete by symbol or company name
router.get('/symbols/search', async (req, res) => {
  try {
    res.json({ results: await symbolSearch.search(req.query.q) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// Dashboard APIs
// ═══════════════════════════════════════════════════════

// GET /api/flattrade/status — is the broker session valid?
router.get('/flattrade/status', async (req, res) => {
  try {
    res.json(await marketData.getFlattradeStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/flattrade/account — real-money balance, positions and holdings (read-only)
router.get('/flattrade/account', async (req, res) => {
  try {
    res.json(await marketData.getFlattradeAccount());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/flattrade/orders', async (req, res) => {
  try {
    res.json({ orders: await flattradeOrders.getOrderBook(), source: 'flattrade' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/flattrade/auth/start — returns the Flattrade login URL to open in a new tab
router.post('/flattrade/auth/start', (req, res) => {
  try {
    res.json({ url: flattradeAuth.startUrl() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center"><h2>${title}</h2><p>${body}</p></body>`;

// GET /api/flattrade/callback — Flattrade redirects here with ?code=...; exchange it for the token
export async function flattradeCallback(req, res) {
  const code = String(req.query.code || req.query.request_code || '');
  try {
    await flattradeAuth.completeLogin(code);
    marketData.resetFlattradeCache();
    await req.app.get('liveFeed')?.credentialsUpdated();
    res.send(page('Flattrade connected', 'Authentication is complete and the token is stored. You can close this tab.'));
  } catch (err) {
    const safe = String(err.message).replace(/[<>&"']/g, '');
    res.status(400).send(page('Flattrade authentication failed', safe));
  }
}
router.get('/flattrade/callback', flattradeCallback);

router.get('/live-feed/status', (req, res) => {
  res.json(req.app.get('liveFeed')?.getStatus() || { connected: false, error: 'Live feed unavailable' });
});

router.get('/live-feed/status', (req, res) => {
  const liveFeed = req.app.get('liveFeed');
  res.json(liveFeed ? liveFeed.getStatus() : { connected: false, error: 'Live feed unavailable' });
});

// Re-price open positions so P&L reflects current quotes.
async function refreshPositionPrices() {
  const positions = wallet.getPositions();
  if (!positions.length) return;
  const quotes = await marketData.getQuotes(positions.map((p) => p.symbol));
  const prices = {};
  for (const q of quotes) if (q.ltp) prices[String(q.symbol).replace(/-EQ$/, '')] = q.ltp;
  wallet.updatePositionPrices(prices);
}

// GET /api/dashboard — combined dashboard data
router.get('/dashboard', async (req, res) => {
  try {
    const live = wallet.getWallet().trading_mode === 'live';
    if (!live) await refreshPositionPrices().catch(() => {});
    const liveAccount = live ? await marketData.getFlattradeAccount().catch((e) => ({ connected: false, error: e.message })) : null;
    const walletInfo = wallet.getWallet();
    const positions = wallet.getPositions();
    const stats = wallet.getTradeStats();
    const recentTrades = wallet.getTradeHistory(5);
    const watchlist = wallet.getWatchlist();

    res.json({
      wallet: walletInfo,
      live_account: liveAccount,
      positions,
      stats,
      recent_trades: recentTrades,
      watchlist,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// Market Data APIs
// ═══════════════════════════════════════════════════════

// POST /api/quotes — fetch live quotes
router.post('/quotes', async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!symbols || !symbols.length) {
      return res.status(400).json({ error: 'No symbols provided' });
    }
    const quotes = await marketData.getQuotes(symbols);
    res.json({ data: quotes, count: quotes.length, flattrade_error: marketData.flattradeError ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analyze — run stock monitor agent
router.post('/analyze', async (req, res) => {
  try {
    const { symbols, interval = '5m' } = req.body;
    if (!symbols || !symbols.length) {
      return res.status(400).json({ error: 'No symbols provided' });
    }
    const results = await marketData.analyzeStocks(symbols, interval);
    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/candles — OHLCV for live chart
router.get('/candles', async (req, res) => {
  try {
    const { symbol, interval = '5m' } = req.query;
    if (!symbol) return res.status(400).json({ error: 'No symbol provided' });
    const result = await marketData.getCandles(symbol, interval);
    res.json({ ...result, symbol, interval });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/news — RSS headlines with sentiment
router.get('/news', async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'No symbol provided' });
    res.json(await newsService.getNews(symbol));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scan — intraday BUY/SELL picks above a confidence threshold
router.get('/scan', async (req, res) => {
  try {
    const { interval = '5m', min_confidence = 60, universe = 'nifty50' } = req.query;
    res.json(await marketData.scanMarket(interval, min_confidence, universe));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/historical — fetch historical data
router.get('/historical', async (req, res) => {
  try {
    const { symbol, period = '1mo', interval = '1d' } = req.query;
    if (!symbol) return res.status(400).json({ error: 'No symbol provided' });
    const data = await marketData.getHistorical(symbol, period, interval);
    res.json({ data, symbol, period });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// Wallet APIs
// ═══════════════════════════════════════════════════════

// GET /api/wallet
router.get('/wallet', async (req, res) => {
  try {
    await refreshPositionPrices().catch(() => {});
    res.json(wallet.getWallet());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wallet/reset
router.post('/wallet/reset', (req, res) => {
  try {
    const { starting_balance = 1000000 } = req.body;
    const result = wallet.resetWallet(starting_balance);
    res.json({ success: true, wallet: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// Trading APIs
// ═══════════════════════════════════════════════════════

// POST /api/order — place an order
router.post('/order', async (req, res) => {
  try {
    if (wallet.getWallet().trading_mode === 'live') {
      if (req.body?.liveConfirmed !== true) {
        return res.status(400).json({ success: false, error: 'Explicit live-order confirmation is required.' });
      }
      const result = await flattradeOrders.placeMarketOrder(req.body);
      return res.json(result);
    }
    const result = wallet.placeOrder(req.body);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/positions
router.get('/positions', async (req, res) => {
  try {
    if (wallet.getWallet().trading_mode === 'live') {
      const acc = await marketData.getFlattradeAccount();
      const positions = (acc.account?.positions || []).map((p) => ({ ...p, exchange: 'NSE' }));
      return res.json({ positions, count: positions.length, account: acc.account, connected: acc.connected, source: 'flattrade', error: acc.error });
    }
    await refreshPositionPrices().catch(() => {});
    const positions = wallet.getPositions();
    res.json({ positions, count: positions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trades — trade history
router.get('/trades', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const trades = wallet.getTradeHistory(parseInt(limit));
    const stats = wallet.getTradeStats();
    res.json({ trades, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// Watchlist APIs
// ═══════════════════════════════════════════════════════

// GET /api/watchlist
router.get('/watchlist', (req, res) => {
  try {
    res.json({ watchlist: wallet.getWatchlist() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/watchlist — add symbol
router.post('/watchlist', (req, res) => {
  try {
    const { symbol, exchange = 'NSE' } = req.body;
    if (!symbol) return res.status(400).json({ error: 'No symbol provided' });
    const result = wallet.addToWatchlist(symbol, exchange);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/watchlist/:symbol
router.delete('/watchlist/:symbol', (req, res) => {
  try {
    const result = wallet.removeFromWatchlist(req.params.symbol);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// Broker APIs
// ═══════════════════════════════════════════════════════

// GET /api/brokers
const MASK = '\u2022\u2022\u2022\u2022';
router.get('/brokers', (req, res) => {
  try {
    const db = wallet.db;
    // Secrets never leave the server; the form shows a masked placeholder instead.
    const brokers = db.prepare('SELECT * FROM brokers').all().map(({ api_secret, user_token, ...b }) => ({
      ...b,
      api_key: b.api_key ? `${MASK}${b.api_key.slice(-4)}` : '',
      api_secret: api_secret ? MASK : '',
    }));
    const walletInfo = wallet.getWallet();
    res.json({ brokers, trading_mode: walletInfo.trading_mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brokers — add/update broker config
router.post('/brokers', (req, res) => {
  try {
    const { id, name, broker_type, api_key, api_secret, user_id, redirect_url } = req.body;
    const db = wallet.db;
    const old = db.prepare('SELECT api_key, api_secret FROM brokers WHERE id = ?').get(id) || {};
    // A masked or blank value means "keep what is saved".
    const keep = (incoming, saved) => (!incoming || String(incoming).startsWith(MASK) ? (saved || '') : String(incoming).trim());
    db.prepare(`
      INSERT INTO brokers (id, name, broker_type, api_key, api_secret, user_id, redirect_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, broker_type = excluded.broker_type, api_key = excluded.api_key,
        api_secret = excluded.api_secret, user_id = excluded.user_id, redirect_url = excluded.redirect_url, updated_at = excluded.updated_at
    `).run(id, name, broker_type, keep(api_key, old.api_key), keep(api_secret, old.api_secret), user_id || '', redirect_url || '');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trading-mode — switch demo/live
router.post('/trading-mode', (req, res) => {
  try {
    const { mode } = req.body;
    if (!['demo', 'live'].includes(mode)) {
      return res.status(400).json({ error: 'Mode must be "demo" or "live"' });
    }
    const db = wallet.db;
    autoTrader.setLiveArmed(false);
    if (mode === 'live') db.prepare("UPDATE ai_settings SET auto_trade_enabled = 0 WHERE id = 1").run();
    db.prepare("UPDATE wallet SET trading_mode = ?, updated_at = datetime('now') WHERE id = 1").run(mode);
    res.json({ success: true, mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// Agent APIs
// ═══════════════════════════════════════════════════════

// ── Gemini AI + auto-trader ──

router.get('/ai/settings', (req, res) => {
  try {
    res.json(gemini.getPublicSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ai/settings', (req, res) => {
  try {
    res.json(gemini.updateSettings(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/ai/skills', (req, res) => {
  try {
    res.json({ skills: listTradingSkills() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/test — verify the saved key and model
router.post('/ai/test', async (req, res) => {
  try {
    const only = PROVIDERS.includes(req.body?.provider) ? req.body.provider : undefined;
    const out = await gemini.generateJson('Reply ONLY with JSON {"ok": true}', { only });
    res.json({ success: out?.ok === true, provider: gemini.lastUsed });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/autotrade/status', (req, res) => {
  try {
    res.json({ ...autoTrader.getStatus(), stats: autoTrader.getStats(), decisions: autoTrader.getDecisions() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/autotrade/calibration/backtest', async (_req, res) => {
  try {
    const settings = gemini.getSettings();
    const walletInfo = wallet.getWallet();
    const report = await marketData.backtestWatchlist(
      wallet.getWatchlist(),
      settings.candidate_min_confidence,
      walletInfo.starting_balance,
      settings.position_pct,
    );
    res.json(report);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/autotrade/toggle', async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    if (enabled) {
      if (!gemini.isReady()) return res.status(400).json({ error: 'Enable AI (Gemini or ChatGPT) in Integrations first' });
      if (wallet.getWallet().trading_mode === 'live') {
        if (req.body?.liveConfirmed !== true) return res.status(400).json({ error: 'Explicit live AI trading confirmation is required.' });
        const status = await marketData.getFlattradeStatus();
        if (!status.connected) return res.status(400).json({ error: `Flattrade is not connected: ${status.error || 'authenticate on Integrations first'}` });
        await flattradeOrders.verifyStaticIp();
        await flattradeOrders.getAccount();
        autoTrader.setLiveArmed(true);
      } else {
        autoTrader.setLiveArmed(false);
      }
    } else {
      autoTrader.setLiveArmed(false);
    }
    gemini.updateSettings({ auto_trade_enabled: enabled });
    if (enabled) autoTrader.tick().catch((e) => console.error('AutoTrader tick failed:', e.message));
    res.json(autoTrader.getStatus());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/autotrade/run — one manual cycle, ignoring market hours
router.post('/autotrade/run', async (req, res) => {
  try {
    res.json(await autoTrader.tick({ force: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agent/logs
router.get('/agent/logs', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const logs = wallet.getAgentLogs(parseInt(limit));
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agent/lessons — correction agent lessons
router.get('/agent/lessons', (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
    const lessons = wallet.getLessons(limit, offset);
    res.json({ lessons, total: wallet.getLessonCount(), limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
