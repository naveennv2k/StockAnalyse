import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', '..', 'pythonAPI', '.nse_equity_list.csv');
const SOURCE = 'https://archives.nseindia.com/content/equities/EQUITY_L.csv';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const SERIES_RANK = { EQ: 0, BE: 1, BZ: 2 };

// Minimal CSV line parser that understands double-quoted fields.
function parseLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export class SymbolSearch {
  constructor() {
    this.stocks = null;
    this.loading = null;
  }

  async _load() {
    const stale = !fs.existsSync(CACHE_PATH) || Date.now() - fs.statSync(CACHE_PATH).mtimeMs > MAX_AGE_MS;
    if (stale) {
      try {
        const res = await fetch(SOURCE, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.startsWith('SYMBOL')) throw new Error('Unexpected file');
        fs.writeFileSync(`${CACHE_PATH}.tmp`, text);
        fs.renameSync(`${CACHE_PATH}.tmp`, CACHE_PATH);
      } catch (e) {
        if (!fs.existsSync(CACHE_PATH)) throw new Error(`Could not download the NSE stock list (${e.message})`);
      }
    }
    const lines = fs.readFileSync(CACHE_PATH, 'utf8').split(/\r?\n/).slice(1);
    this.stocks = lines.filter(Boolean).map(parseLine)
      .filter((c) => /^[A-Z0-9&_-]{1,20}$/.test(c[0]))
      .map((c) => ({ symbol: c[0], name: c[1], series: c[2] }));
  }

  async search(query, limit = 10) {
    this.loading ??= this._load().catch((e) => { this.loading = null; throw e; });
    if (!this.stocks) await this.loading;

    const q = String(query || '').trim().toUpperCase().slice(0, 30);
    if (!q) return [];

    const scored = [];
    for (const s of this.stocks) {
      const name = s.name.toUpperCase();
      let score;
      if (s.symbol === q) score = 0;
      else if (s.symbol.startsWith(q)) score = 1;
      else if (name.startsWith(q)) score = 2;
      else if (s.symbol.includes(q)) score = 3;
      else if (name.includes(q)) score = 4;
      else continue;
      scored.push([score, SERIES_RANK[s.series] ?? 3, s.symbol.length, s]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    return scored.slice(0, limit).map((x) => x[3]);
  }
}

export default SymbolSearch;
