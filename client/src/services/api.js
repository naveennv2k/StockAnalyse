const BASE = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Dashboard
export const getDashboard = () => request('/dashboard');

// Market Data
export const getQuotes = (symbols) => request('/quotes', { method: 'POST', body: JSON.stringify({ symbols }) });
export const analyzeStocks = (symbols, interval = '5m') => request('/analyze', { method: 'POST', body: JSON.stringify({ symbols, interval }) });
export const getCandles = (symbol, interval = '5m') => request(`/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}`);
export const getNews = (symbol) => request(`/news?symbol=${encodeURIComponent(symbol)}`);
export const scanMarket = (interval = '5m', minConfidence = 60, universe = 'nifty50') => request(`/scan?interval=${interval}&min_confidence=${minConfidence}&universe=${universe}`);
export const getFlattradeStatus = () => request('/flattrade/status');
export const startFlattradeAuth = () => request('/flattrade/auth/start', { method: 'POST' });
export const searchSymbols = (q) => request(`/symbols/search?q=${encodeURIComponent(q)}`);
export const getHistorical = (symbol, period = '1mo', interval = '1d') => request(`/historical?symbol=${symbol}&period=${period}&interval=${interval}`);

// Wallet
export const getWallet = () => request('/wallet');
export const resetWallet = (starting_balance) => request('/wallet/reset', { method: 'POST', body: JSON.stringify({ starting_balance }) });

// Trading
export const placeOrder = (order) => request('/order', { method: 'POST', body: JSON.stringify(order) });
export const getPositions = () => request('/positions');
export const getTrades = (limit = 50) => request(`/trades?limit=${limit}`);

// Watchlist
export const getWatchlist = () => request('/watchlist');
export const addToWatchlist = (symbol) => request('/watchlist', { method: 'POST', body: JSON.stringify({ symbol }) });
export const removeFromWatchlist = (symbol) => request(`/watchlist/${symbol}`, { method: 'DELETE' });

// Brokers
export const getBrokers = () => request('/brokers');
export const saveBroker = (broker) => request('/brokers', { method: 'POST', body: JSON.stringify(broker) });
export const setTradingMode = (mode) => request('/trading-mode', { method: 'POST', body: JSON.stringify({ mode }) });

// Agents
export const getAgentLogs = (limit = 50) => request(`/agent/logs?limit=${limit}`);
export const getLessons = () => request('/agent/lessons');

// Gemini AI + auto-trader
export const getAiSettings = () => request('/ai/settings');
export const getAvailableAiSkills = () => request('/ai/skills');
export const saveAiSettings = (settings) => request('/ai/settings', { method: 'POST', body: JSON.stringify(settings) });
export const testAi = (provider) => request('/ai/test', { method: 'POST', body: JSON.stringify({ provider }) });
export const getAutoTradeStatus = () => request('/autotrade/status');
export const toggleAutoTrade = (enabled) => request('/autotrade/toggle', { method: 'POST', body: JSON.stringify({ enabled }) });
export const runAutoTradeNow = () => request('/autotrade/run', { method: 'POST' });
