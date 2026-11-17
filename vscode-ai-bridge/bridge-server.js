const http = require('http');
const crypto = require('crypto');

const MAX_BODY = 200 * 1024;
const REQUEST_TIMEOUT_MS = 90 * 1000;

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Local HTTP bridge: POST /complete {prompt} -> {text}.
 * Loopback only, token protected, one request at a time.
 */
function createBridge({ getToken, complete, log = () => {} }) {
  let server = null;
  let queue = Promise.resolve();

  function send(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  }

  async function handle(req, res, port) {
    // Browsers always send Origin and a non-loopback Host under DNS rebinding; reject both.
    const host = String(req.headers.host || '');
    if (req.headers.origin || !(host === `127.0.0.1:${port}` || host === `localhost:${port}`)) return send(res, 403, { error: 'forbidden' });
    if (!safeEqual(req.headers['x-bridge-token'] || '', await getToken())) return send(res, 401, { error: 'invalid token' });
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
    if (req.method !== 'POST' || req.url !== '/complete') return send(res, 404, { error: 'not found' });

    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return send(res, 413, { error: 'prompt too large' });
      chunks.push(chunk);
    }
    let prompt;
    try { prompt = JSON.parse(Buffer.concat(chunks).toString()).prompt; } catch { return send(res, 400, { error: 'invalid JSON' }); }
    if (typeof prompt !== 'string' || !prompt.trim()) return send(res, 400, { error: 'prompt is required' });

    // Serialize: Copilot handles one request at a time more reliably than a burst.
    const run = queue.then(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return { text: await complete(prompt, controller.signal) };
      } finally {
        clearTimeout(timer);
      }
    });
    queue = run.catch(() => {});
    try {
      send(res, 200, await run);
    } catch (e) {
      log(`request failed: ${e.message}`);
      send(res, e.status || 502, { error: e.message });
    }
  }

  return {
    start(port) {
      return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          handle(req, res, port).catch((e) => { log(e.message); if (!res.headersSent) send(res, 500, { error: 'internal error' }); });
        });
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
      });
    },
    stop() {
      return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
    },
    get running() {
      return !!server?.listening;
    },
  };
}

module.exports = { createBridge };
