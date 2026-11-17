import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '..', 'pythonAPI', '.env');
const AUTH_PAGE = 'https://auth.flattrade.in/';
const TOKEN_API = 'https://authapi.flattrade.in/trade/apitoken';
const PENDING_MS = 10 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Set KEY=value in the Python .env atomically, keeping it private.
function setEnvValue(key, value) {
  const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8').split('\n') : [];
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const i = lines.findIndex((l) => re.test(l));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  const tmp = `${ENV_PATH}.tmp`;
  fs.writeFileSync(tmp, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  fs.renameSync(tmp, ENV_PATH);
}

/**
 * Flattrade OAuth-style login:
 * 1. user opens the Flattrade login page for our API key
 * 2. Flattrade redirects to our callback with ?code=...
 * 3. we hash api_key + code + api_secret and exchange it for the API token
 */
export class FlattradeAuth {
  constructor(db) {
    this.db = db;
    this.pendingUntil = 0;
  }

  _config() {
    return this.db.prepare(`SELECT api_key, api_secret FROM brokers WHERE id = 'flattrade'`).get();
  }

  startUrl() {
    const cfg = this._config();
    if (!cfg?.api_key || !cfg?.api_secret) throw new Error('Save your Flattrade API key and secret first');
    this.pendingUntil = Date.now() + PENDING_MS;
    return `${AUTH_PAGE}?app_key=${encodeURIComponent(cfg.api_key)}`;
  }

  async completeLogin(code) {
    // Only accept a code while a login that we started is in progress.
    if (Date.now() > this.pendingUntil) throw new Error('No login in progress. Start authentication from the Integrations page.');
    if (!/^[A-Za-z0-9._-]{6,300}$/.test(code || '')) throw new Error('Invalid authorization code');
    const cfg = this._config();
    if (!cfg?.api_key || !cfg?.api_secret) throw new Error('Flattrade API key and secret are not saved');

    const res = await fetch(TOKEN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: cfg.api_key, request_code: code, api_secret: sha256(`${cfg.api_key}${code}${cfg.api_secret}`) }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(`Token exchange failed: ${data.emsg || data.error || JSON.stringify(data).slice(0, 150)}`);
    if (!/^[A-Za-z0-9._-]{10,300}$/.test(data.token)) throw new Error('Flattrade returned an unexpected token format');

    const client = typeof data.client === 'string' && /^[A-Za-z0-9]{3,20}$/.test(data.client) ? data.client : null;
    setEnvValue('FLATTRADE_USER_TOKEN', data.token);
    if (client) {
      setEnvValue('FLATTRADE_USER_ID', client);
      this.db.prepare(`UPDATE brokers SET user_id = ?, is_connected = 1, updated_at = datetime('now') WHERE id = 'flattrade'`).run(client);
    }
    this.pendingUntil = 0;
    return { client };
  }
}

export default FlattradeAuth;
