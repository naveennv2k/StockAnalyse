import { getDb } from '../db/database.js';
import { normalizeTradingSkillIds } from './tradingSkills.js';

const MODEL_RE = /^[A-Za-z0-9._-]{1,60}$/;
const OLLAMA_MODEL_RE = /^[A-Za-z0-9._:/-]{1,80}$/;
const KEY_FORMAT = /^[\x21-\x7E]{10,300}$/; // printable ASCII, no whitespace (keeps header values safe)
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const LOCAL_URL_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export const PROVIDERS = ['gemini', 'openai', 'vscode', 'ollama'];
export const LABELS = { gemini: 'Gemini', openai: 'ChatGPT (OpenAI)', vscode: 'VS Code Copilot', ollama: 'Ollama (local)' };
const AUTO_TRADE_UNIVERSES = ['watchlist', 'nifty50', 'nifty100', 'nifty200', 'nifty500'];

const cleanKey = (k) => k.trim().replace(/^["']|["']$/g, '');

const intIn = (v, min, max, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
};

/** Parses a model reply that may be wrapped in a code fence or surrounded by prose. */
export function extractJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new Error('reply was not valid JSON');
}

/**
 * Asks the configured AI providers in order (Gemini, ChatGPT, VS Code Copilot, Ollama) and returns
 * the first valid JSON reply, so a rate limit on one provider falls through to the next.
 */
export class GeminiService {
  constructor() {
    this.db = getDb();
    this.calls = Object.fromEntries(PROVIDERS.map((p) => [p, []])); // call timestamps per provider; resets on restart
    this.status = {}; // provider -> { ok, at, error }
    this.lastUsed = null;
  }

  getSettings() {
    return this.db.prepare('SELECT * FROM ai_settings WHERE id = 1').get();
  }

  /** Ordered list of providers to try. */
  chain(s = this.getSettings()) {
    const raw = (s.ai_chain || s.ai_provider || 'gemini').split(',').map((x) => x.trim());
    const list = [...new Set(raw.filter((p) => PROVIDERS.includes(p)))];
    return list.length ? list : ['gemini'];
  }

  _configured(provider, s) {
    if (provider === 'gemini') return !!s.gemini_api_key;
    if (provider === 'openai') return !!s.openai_api_key;
    if (provider === 'vscode') return !!s.vscode_token;
    return !!(s.ollama_url && s.ollama_model);
  }

  // Never expose secrets to the browser.
  getPublicSettings() {
    const { gemini_api_key, openai_api_key, vscode_token, ...rest } = this.getSettings();
    const hint = (k) => (k ? `\u2022\u2022\u2022\u2022${k.slice(-4)}` : '');
    let skills = [];
    try { skills = JSON.parse(rest.trading_skills || '[]'); } catch { skills = []; }
    let repoSkillIds = [];
    try { repoSkillIds = JSON.parse(rest.trading_skill_ids || '[]'); } catch { repoSkillIds = []; }
    return {
      ...rest,
      trading_skills: Array.isArray(skills) ? skills : [],
      trading_skill_ids: Array.isArray(repoSkillIds) ? repoSkillIds : [],
      ai_chain: this.chain(),
      has_gemini_key: !!gemini_api_key,
      gemini_key_hint: hint(gemini_api_key),
      has_openai_key: !!openai_api_key,
      openai_key_hint: hint(openai_api_key),
      has_vscode_token: !!vscode_token,
      vscode_token_hint: hint(vscode_token),
      provider_status: this.status,
      last_used: this.lastUsed,
      calls_last_hour: PROVIDERS.reduce((n, p) => n + this._recentCalls(p).length, 0),
    };
  }

  updateSettings(patch) {
    const cur = this.getSettings();
    const next = { ...cur };

    if (patch.clear_api_key) next.gemini_api_key = '';
    if (patch.clear_openai_key) next.openai_api_key = '';
    if (patch.clear_vscode_token) next.vscode_token = '';
    for (const [field, name] of [['gemini_api_key', 'Gemini'], ['openai_api_key', 'OpenAI']]) {
      if (typeof patch[field] === 'string' && patch[field].trim()) {
        const key = cleanKey(patch[field]);
        if (!KEY_FORMAT.test(key)) throw new Error(`${name} API key has unexpected characters or spaces; paste only the key`);
        next[field] = key;
      }
    }
    if (typeof patch.vscode_token === 'string' && patch.vscode_token.trim()) {
      const token = cleanKey(patch.vscode_token);
      if (!TOKEN_RE.test(token)) throw new Error('VS Code bridge token looks invalid; copy it from the "AI Bridge: Copy Token" command');
      next.vscode_token = token;
    }
    if (patch.vscode_port !== undefined) next.vscode_port = intIn(patch.vscode_port, 1024, 65535, 'vscode_port');
    if (patch.ollama_url !== undefined) {
      const url = String(patch.ollama_url).trim().replace(/\/$/, '');
      if (!LOCAL_URL_RE.test(url)) throw new Error('Ollama URL must be http://localhost:PORT or http://127.0.0.1:PORT');
      next.ollama_url = url;
    }
    if (patch.ollama_model !== undefined) {
      if (!OLLAMA_MODEL_RE.test(patch.ollama_model)) throw new Error('Invalid Ollama model name');
      next.ollama_model = patch.ollama_model;
    }
    if (patch.ai_chain !== undefined) {
      const list = (Array.isArray(patch.ai_chain) ? patch.ai_chain : []).filter((p) => PROVIDERS.includes(p));
      if (!list.length) throw new Error('Select at least one AI provider');
      next.ai_chain = [...new Set(list)].join(',');
      next.ai_provider = list[0] === 'gemini' || list[0] === 'openai' ? list[0] : next.ai_provider;
    }
    if (patch.gemini_model !== undefined) {
      if (!MODEL_RE.test(patch.gemini_model)) throw new Error('Invalid model name');
      next.gemini_model = patch.gemini_model;
    }
    if (patch.openai_model !== undefined) {
      if (!MODEL_RE.test(patch.openai_model)) throw new Error('Invalid model name');
      next.openai_model = patch.openai_model;
    }
    if (patch.ai_enabled !== undefined) next.ai_enabled = patch.ai_enabled ? 1 : 0;
    if (patch.auto_trade_enabled !== undefined) next.auto_trade_enabled = patch.auto_trade_enabled ? 1 : 0;
    if (patch.trading_instructions !== undefined) {
      if (typeof patch.trading_instructions !== 'string') throw new Error('Trade instructions must be text');
      next.trading_instructions = patch.trading_instructions.replace(/\0/g, '').slice(0, 1500).trim();
    }
    if (patch.trading_skills !== undefined) {
      if (!Array.isArray(patch.trading_skills)) throw new Error('Trading skills must be a list');
      if (patch.trading_skills.length > 10) throw new Error('Add no more than 10 trading skills');
      const ids = new Set();
      const skills = patch.trading_skills.map((skill, i) => {
        if (!skill || typeof skill !== 'object') throw new Error(`Trading skill ${i + 1} is invalid`);
        const id = String(skill.id || `skill-${i + 1}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
        const name = typeof skill.name === 'string' ? skill.name.replace(/\0/g, '').trim().slice(0, 60) : '';
        const instructions = typeof skill.instructions === 'string' ? skill.instructions.replace(/\0/g, '').trim().slice(0, 1000) : '';
        if (!id || !name || !instructions) throw new Error(`Trading skill ${i + 1} needs a name and instructions`);
        if (ids.has(id)) throw new Error('Trading skill IDs must be unique');
        ids.add(id);
        return { id, name, instructions, enabled: skill.enabled !== false };
      });
      next.trading_skills = JSON.stringify(skills);
    }
    if (patch.trading_skill_ids !== undefined) {
      next.trading_skill_ids = JSON.stringify(normalizeTradingSkillIds(patch.trading_skill_ids));
    }
    if (patch.auto_trade_universe !== undefined) {
      if (!AUTO_TRADE_UNIVERSES.includes(patch.auto_trade_universe)) throw new Error('Invalid auto-trade universe');
      next.auto_trade_universe = patch.auto_trade_universe;
    }
    if (patch.max_calls_per_hour !== undefined) next.max_calls_per_hour = intIn(patch.max_calls_per_hour, 1, 1000, 'max_calls_per_hour');
    if (patch.position_pct !== undefined) next.position_pct = intIn(patch.position_pct, 1, 25, 'position_pct');
    if (patch.max_positions !== undefined) next.max_positions = intIn(patch.max_positions, 1, 20, 'max_positions');
    if (patch.candidate_min_confidence !== undefined) next.candidate_min_confidence = intIn(patch.candidate_min_confidence, 0, 100, 'candidate_min_confidence');
    if (patch.ai_min_confidence !== undefined) next.ai_min_confidence = intIn(patch.ai_min_confidence, 0, 100, 'ai_min_confidence');

    if (next.ai_enabled && !this.chain(next).some((p) => this._configured(p, next))) {
      throw new Error('Configure at least one provider in the fallback order before enabling AI');
    }

    this.db.prepare(`
      UPDATE ai_settings SET gemini_api_key = ?, gemini_model = ?, ai_enabled = ?, max_calls_per_hour = ?,
        auto_trade_enabled = ?, position_pct = ?, max_positions = ?, candidate_min_confidence = ?, ai_min_confidence = ?,
        ai_provider = ?, openai_api_key = ?, openai_model = ?, ai_chain = ?, vscode_port = ?, vscode_token = ?,
        ollama_url = ?, ollama_model = ?, trading_instructions = ?, trading_skills = ?, trading_skill_ids = ?, auto_trade_universe = ?
      WHERE id = 1
    `).run(next.gemini_api_key, next.gemini_model, next.ai_enabled, next.max_calls_per_hour,
      next.auto_trade_enabled, next.position_pct, next.max_positions, next.candidate_min_confidence, next.ai_min_confidence,
      next.ai_provider, next.openai_api_key, next.openai_model, next.ai_chain, next.vscode_port, next.vscode_token,
      next.ollama_url, next.ollama_model, next.trading_instructions, next.trading_skills, next.trading_skill_ids, next.auto_trade_universe);
    return this.getPublicSettings();
  }

  isReady() {
    const s = this.getSettings();
    return !!(s.ai_enabled && this.chain(s).some((p) => this._configured(p, s)));
  }

  _recentCalls(provider) {
    const cutoff = Date.now() - 3600000;
    this.calls[provider] = this.calls[provider].filter((t) => t > cutoff);
    return this.calls[provider];
  }

  /**
   * Returns the parsed JSON reply of the first provider that answers.
   * `only` tests a single provider (used by the Test button) and ignores the enabled switch.
   */
  async generateJson(prompt, { only } = {}) {
    const s = this.getSettings();
    if (!only && !s.ai_enabled) throw new Error('AI is not enabled');
    const order = only ? [only] : this.chain(s);
    const failures = [];

    for (const provider of order) {
      if (!this._configured(provider, s)) { failures.push(`${LABELS[provider]}: not configured`); continue; }
      if (this._recentCalls(provider).length >= s.max_calls_per_hour) { failures.push(`${LABELS[provider]}: hourly limit reached`); continue; }
      this.calls[provider].push(Date.now());
      try {
        const out = await this._call(provider, prompt, s);
        this.status[provider] = { ok: true, at: new Date().toISOString(), error: null };
        this.lastUsed = provider;
        return out;
      } catch (e) {
        this.status[provider] = { ok: false, at: new Date().toISOString(), error: e.message };
        failures.push(`${LABELS[provider]}: ${e.message}`);
      }
    }
    throw new Error(`No AI provider answered. ${failures.join(' | ')}`);
  }

  _call(provider, prompt, s) {
    if (provider === 'gemini') {
      return this._remote('Gemini', {
        url: `${GEMINI_URL}/${encodeURIComponent(s.gemini_model)}:generateContent`,
        headers: { 'x-goog-api-key': s.gemini_api_key },
        body: { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } },
        text: (b) => b?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '',
      }, { retries: 1 });
    }
    if (provider === 'openai') {
      return this._remote('OpenAI', {
        url: OPENAI_URL,
        headers: { Authorization: `Bearer ${s.openai_api_key}` },
        body: { model: s.openai_model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } },
        text: (b) => b?.choices?.[0]?.message?.content || '',
      }, { retries: 1 });
    }
    if (provider === 'vscode') {
      return this._remote('VS Code Copilot', {
        url: `http://127.0.0.1:${s.vscode_port}/complete`,
        headers: { 'x-bridge-token': s.vscode_token },
        body: { prompt },
        text: (b) => b?.text || '',
      }, { retries: 0, timeoutMs: 90000, unreachable: 'VS Code bridge not reachable (is VS Code open with the AI Bridge extension?)' });
    }
    return this._remote('Ollama', {
      url: `${s.ollama_url}/api/chat`,
      headers: {},
      body: { model: s.ollama_model, messages: [{ role: 'user', content: prompt }], stream: false, format: 'json' },
      text: (b) => b?.message?.content || '',
    }, { retries: 0, timeoutMs: 120000, unreachable: 'Ollama not reachable (is it running?)' });
  }

  async _remote(label, req, { retries, timeoutMs = 25000, unreachable } = {}) {
    let res;
    let body;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        res = await fetch(req.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...req.headers },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        if (attempt < retries) continue;
        throw new Error(e.name === 'TimeoutError' ? 'did not respond in time' : (unreachable || e.message));
      }
      body = await res.json().catch(() => ({}));
      // Providers return 503/429 during demand spikes; one retry usually succeeds.
      if (res.ok || ![429, 500, 503].includes(res.status) || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!res.ok) throw new Error(`API ${res.status}: ${body?.error?.message || body?.error || 'request failed'}`);
    try {
      return extractJson(req.text(body));
    } catch (e) {
      throw new Error(`${label} ${e.message}`);
    }
  }
}

export default GeminiService;
