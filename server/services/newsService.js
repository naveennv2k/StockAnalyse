const CACHE_MS = 5 * 60 * 1000;
const MAX_ITEMS = 10;

const POSITIVE = ['surge', 'surges', 'jump', 'jumps', 'rally', 'rallies', 'gain', 'gains', 'rise', 'rises', 'soar', 'soars',
  'beat', 'beats', 'profit', 'growth', 'record', 'upgrade', 'upgrades', 'buy', 'bullish', 'strong', 'outperform', 'wins', 'order win',
  'dividend', 'bonus', 'expansion', 'high', 'positive', 'boost'];
const NEGATIVE = ['fall', 'falls', 'drop', 'drops', 'plunge', 'plunges', 'slump', 'slumps', 'loss', 'losses', 'miss', 'misses', 'decline',
  'downgrade', 'downgrades', 'sell', 'bearish', 'weak', 'probe', 'fraud', 'penalty', 'fine', 'lawsuit', 'cut', 'cuts', 'low', 'negative',
  'crash', 'warning', 'default', 'resigns'];

// Swap this function for an LLM call later; keep the -1..1 contract.
export function scoreHeadline(text) {
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  const set = new Set(words);
  let score = 0;
  for (const w of POSITIVE) if (set.has(w)) score += 1;
  for (const w of NEGATIVE) if (set.has(w)) score -= 1;
  return Math.max(-1, Math.min(1, score / 2));
}

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};

export class NewsService {
  constructor() {
    this.cache = new Map();
  }

  async getNews(symbol) {
    if (!/^[A-Za-z0-9&_-]{1,20}$/.test(symbol)) throw new Error('Invalid symbol');
    const key = symbol.toUpperCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.time < CACHE_MS) return hit.data;

    const q = encodeURIComponent(`${key} stock NSE`);
    const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`News feed error ${res.status}`);
    const xml = await res.text();

    const now = Date.now();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, MAX_ITEMS).map(([, block]) => {
      const title = tag(block, 'title');
      const published = new Date(tag(block, 'pubDate'));
      return {
        title,
        link: tag(block, 'link'),
        source: tag(block, 'source'),
        published: isNaN(published) ? null : published.toISOString(),
        sentiment: scoreHeadline(title),
      };
    });

    // Recency-weighted average: weight halves every 24h.
    let num = 0, den = 0;
    for (const it of items) {
      const ageH = it.published ? Math.max(0, (now - Date.parse(it.published)) / 3.6e6) : 48;
      const w = Math.pow(0.5, ageH / 24);
      num += it.sentiment * w;
      den += w;
    }
    const score = den ? Number((num / den).toFixed(2)) : 0;
    const label = score > 0.15 ? 'POSITIVE' : score < -0.15 ? 'NEGATIVE' : 'NEUTRAL';

    const data = { symbol: key, score, label, items };
    this.cache.set(key, { data, time: now });
    return data;
  }
}

export default NewsService;
