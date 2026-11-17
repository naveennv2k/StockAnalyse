import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PY_DIR = path.join(__dirname, '..', '..', 'pythonAPI');
const ENV_PATH = path.join(PY_DIR, '.env');
const TOKEN_CACHE = path.join(PY_DIR, '.flattrade_tokens.json');
const WS_URL = 'wss://piconnect.flattrade.in/PiConnectWSAPI/';
const REST = 'https://piconnect.flattrade.in/PiConnectAPI';
const SYMBOL_RE = /^[A-Z0-9&_-]{1,20}$/;
const MAX_SYMBOLS = 100;

const num = (v) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

function readEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const m = line.match(/^\s*(FLATTRADE_USER_ID|FLATTRADE_USER_TOKEN)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env yet */ }
  return out;
}

/**
 * Streams Flattrade touchline ticks and pushes them to browsers over Socket.IO, at most once per second per symbol.
 */
export class LiveFeed extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
    this.ws = null;
    this.status = { connected: false, error: null };
    this.connecting = null;
    this.tokens = new Map(); // symbol -> token
    this.symbols = new Map(); // token -> symbol
    this.latest = new Map(); // symbol -> merged tick state
    this.dirty = new Set();
    this.wanted = new Map(); // symbol -> number of sockets watching it
    this.systemWanted = new Set(); // auto-trader symbols, independent of browser tabs
    this.subscribed = new Set(); // symbols subscribed on the Flattrade socket
    this.backoff = 5000;
    this.retry = null;
    this.syncQueue = Promise.resolve();
    this.lastFrameAt = 0;
    setInterval(() => this._flush(), 1000);
    setInterval(() => this._heartbeat(), 25000);
  }

  getStatus() {
    return {
      ...this.status,
      watched_symbols: this.wanted.size,
      subscribed_symbols: this.subscribed.size,
      max_subscriptions: MAX_SYMBOLS,
    };
  }

  getLatest(symbol) {
    return this.latest.get(symbol) || null;
  }

  setSystemWatching(symbols) {
    this.systemWanted = new Set(symbols.filter((s) => typeof s === 'string' && SYMBOL_RE.test(s)).slice(0, MAX_SYMBOLS));
    return this._sync();
  }

  async _disconnectAndResync() {
    this._close();
    this._setStatus(false, null);
    if (this.wanted.size || this.systemWanted.size) await this._sync();
  }

  /** Replace the set of symbols one browser socket is watching. */
  async setWatching(socket, symbols) {
    const next = new Set(symbols.filter((s) => typeof s === 'string' && SYMBOL_RE.test(s)).slice(0, MAX_SYMBOLS));
    const prev = socket.data.watching || new Set();
    for (const s of prev) if (!next.has(s)) { socket.leave(`q:${s}`); this._dec(s); }
    for (const s of next) if (!prev.has(s)) { socket.join(`q:${s}`); this.wanted.set(s, (this.wanted.get(s) || 0) + 1); }
    socket.data.watching = next;

    for (const s of next) { const t = this.latest.get(s); if (t) socket.emit('tick', this._payload(s, t)); }
    socket.emit('feed:status', this.status);
    await this._sync();
  }

  credentialsUpdated() {
    this.backoff = 5000;
    return this._disconnectAndResync();
  }

  releaseSocket(socket) {
    for (const s of socket.data.watching || []) this._dec(s);
    socket.data.watching = new Set();
    this._sync().catch(() => {});
  }

  _dec(symbol) {
    const n = (this.wanted.get(symbol) || 1) - 1;
    if (n <= 0) this.wanted.delete(symbol); else this.wanted.set(symbol, n);
  }

  async _sync() {
    this.syncQueue = this.syncQueue.catch(() => {}).then(() => this._syncNow());
    return this.syncQueue;
  }

  async _syncNow() {
    const want = new Set([...this.wanted.keys(), ...this.systemWanted]);
    if (!want.size) { this._close(); this._setStatus(false, null); return; }
    if (this.retry) return;
    const active = new Set([...want].slice(0, MAX_SYMBOLS));
    try {
      await this._connect();
    } catch (e) {
      this._setStatus(false, e.message);
      this._scheduleRetry();
      return;
    }
    const add = [];
    for (const s of active) if (!this.subscribed.has(s)) add.push(s);
    const drop = [...this.subscribed].filter((s) => !active.has(s));

    const resolved = await Promise.all(add.map(async (symbol) => [symbol, await this._token(symbol).catch(() => null)]));
    const addKeys = [];
    for (const [symbol, token] of resolved) {
      if (token && (this.wanted.has(symbol) || this.systemWanted.has(symbol))) { addKeys.push(`NSE|${token}`); this.subscribed.add(symbol); }
    }
    if (addKeys.length) this._send({ t: 't', k: addKeys.join('#') });
    if (drop.length) {
      const keys = drop.map((s) => this.tokens.get(s)).filter(Boolean).map((t) => `NSE|${t}`);
      if (keys.length) this._send({ t: 'u', k: keys.join('#') });
      for (const s of drop) this.subscribed.delete(s);
    }
    this._setStatus(true, want.size > MAX_SYMBOLS ? `Subscription limit: streaming first ${MAX_SYMBOLS} of ${want.size} requested symbols` : null);
  }

  _connect() {
    if (this.ws?.readyState === WebSocket.OPEN && this.status.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;

    const { FLATTRADE_USER_ID: uid, FLATTRADE_USER_TOKEN: token } = readEnv();
    if (!uid || !token) return Promise.reject(new Error('Flattrade is not connected. Authenticate on the Integrations page.'));

    this.connecting = new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      let settled = false;
      let timer;
      const fail = (msg) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.connecting = null;
          reject(new Error(msg));
        }
      };
      timer = setTimeout(() => { fail('Flattrade feed did not respond'); ws.terminate(); }, 10000);

      ws.on('open', () => ws.send(JSON.stringify({ t: 'a', uid, actid: uid, source: 'API', accesstoken: token })));
      ws.on('message', (raw) => {
        this.lastFrameAt = Date.now();
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.t === 'ak') {
          clearTimeout(timer);
          if (String(m.s).toUpperCase() === 'OK') {
            this.ws = ws;
            this.subscribed.clear();
            this.backoff = 5000;
            this._setStatus(true, null);
            if (!settled) { settled = true; this.connecting = null; resolve(); }
          } else {
            fail('Flattrade rejected the session (token expired?). Authenticate again on the Integrations page.');
            ws.close();
          }
        } else if (m.t === 'tk' || m.t === 'tf') {
          this._onTick(m);
        }
      });
      ws.on('close', () => {
        clearTimeout(timer);
        const wasCurrent = this.ws === ws;
        if (wasCurrent) {
          this.ws = null;
          this.subscribed.clear();
          this._setStatus(false, this.status.error);
        }
        fail('Flattrade feed closed');
        if (wasCurrent && this.wanted.size) this._scheduleRetry();
      });
      ws.on('error', (e) => { fail(`Flattrade feed error: ${e.message}`); ws.terminate(); });
    });
    return this.connecting;
  }

  _scheduleRetry() {
    if (this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this._sync().catch(() => {});
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 60000);
  }

  _close() {
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* already closed */ } }
    this.ws = null;
    this.subscribed.clear();
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  _heartbeat() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.lastFrameAt && Date.now() - this.lastFrameAt > 60000) {
      this.ws.terminate();
      return;
    }
    this._send({ t: 'h' });
  }

  _setStatus(connected, error) {
    if (this.status.connected === connected && this.status.error === error) return;
    this.status = { connected, error };
    this.io.emit('feed:status', this.status);
  }

  _onTick(m) {
    const symbol = this.symbols.get(String(m.tk));
    if (!symbol) return;
    const cur = this.latest.get(symbol) || {};
    const next = {
      ltp: num(m.lp) ?? cur.ltp,
      change_pct: num(m.pc) ?? cur.change_pct,
      volume: num(m.v) ?? cur.volume,
      open: num(m.o) ?? cur.open,
      high: num(m.h) ?? cur.high,
      low: num(m.l) ?? cur.low,
      prev_close: num(m.c) ?? cur.prev_close,
      updatedAt: Date.now(),
    };
    this.latest.set(symbol, next);
    this.emit('tick', { symbol, ...next });
    this.dirty.add(symbol);
  }

  _payload(symbol, t) {
    return { symbol, ...t, t: Date.now() };
  }

  // At most one update per symbol per second, however fast the exchange ticks.
  _flush() {
    for (const symbol of this.dirty) this.io.to(`q:${symbol}`).emit('tick', this._payload(symbol, this.latest.get(symbol)));
    this.dirty.clear();
  }

  async _token(symbol) {
    if (this.tokens.has(symbol)) return this.tokens.get(symbol);
    let token;
    try { token = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'))[symbol]; } catch { /* no cache yet */ }
    if (!token) token = await this._searchToken(symbol);
    if (token) {
      this.tokens.set(symbol, token);
      this.symbols.set(String(token), symbol);
      let all = {};
      try {
        all = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
      } catch { /* cache is created on first successful lookup */ }
      if (all[symbol] !== token) {
        all[symbol] = token;
        try {
          fs.writeFileSync(`${TOKEN_CACHE}.tmp`, JSON.stringify(all), { mode: 0o600 });
          fs.renameSync(`${TOKEN_CACHE}.tmp`, TOKEN_CACHE);
        } catch { /* token remains cached in memory for this session */ }
      }
    }
    return token;
  }

  async _searchToken(symbol) {
    const { FLATTRADE_USER_ID: uid, FLATTRADE_USER_TOKEN: accessToken } = readEnv();
    const res = await fetch(`${REST}/SearchScrip`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: `jData=${JSON.stringify({ uid, exch: 'NSE', stext: encodeURIComponent(`${symbol}-EQ`) })}`,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    return (data.values || []).find((v) => v.tsym === `${symbol}-EQ`)?.token || null;
  }
}

export default LiveFeed;
