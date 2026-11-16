import { useState, useEffect } from 'react';
import { getBrokers, saveBroker, setTradingMode, getWallet, resetWallet, getAiSettings, saveAiSettings, testAi, getFlattradeStatus, startFlattradeAuth } from '../services/api';
import { Settings, Wifi, WifiOff, RotateCcw, Shield, Sparkles } from 'lucide-react';

const fmt = (v) => v != null ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

const CALLBACK_URL = `${window.location.origin}/api/flattrade/callback`;

const BROKER_TEMPLATES = [
  { id: 'flattrade', name: 'Flattrade', broker_type: 'flattrade', fields: ['api_key', 'api_secret', 'user_id', 'redirect_url'] },
  { id: 'zerodha', name: 'Zerodha', broker_type: 'zerodha', fields: ['api_key', 'api_secret', 'user_id'] },
  { id: 'angelone', name: 'Angel One', broker_type: 'angelone', fields: ['api_key', 'api_secret', 'user_id'] },
];

export default function Integrations() {
  const [wallet, setWalletState] = useState({});
  const [brokers, setBrokers] = useState([]);
  const [tradingMode, setMode] = useState('demo');
  const [editingBroker, setEditingBroker] = useState(null);
  const [formData, setFormData] = useState({});
  const [startingBalance, setStartingBalance] = useState('1000000');
  const [loading, setLoading] = useState(true);
  const [ftStatus, setFtStatus] = useState(null);
  const [ftBusy, setFtBusy] = useState(false);

  // Opens the Flattrade login in a new tab, then waits for the callback to store the token.
  async function startFlattradeLogin(win) {
    setFtBusy(true);
    try {
      const { url } = await startFlattradeAuth();
      if (win) win.location.href = url;
      else window.open(url, '_blank');
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await getFlattradeStatus();
        setFtStatus(s);
        if (s.connected) break;
      }
    } catch (e) {
      win?.close();
      setFtStatus({ connected: false, error: e.message });
    } finally {
      setFtBusy(false);
    }
  }

  function handleAuthenticate() {
    // Open the tab inside the click so the popup blocker allows it.
    startFlattradeLogin(window.open('', '_blank'));
  }

  useEffect(() => {
    fetchData();
    getFlattradeStatus().then(setFtStatus).catch((e) => setFtStatus({ connected: false, error: e.message }));
  }, []);

  async function fetchData() {
    try {
      const [walletRes, brokerRes] = await Promise.all([getWallet(), getBrokers()]);
      setWalletState(walletRes);
      setBrokers(brokerRes.brokers || []);
      setMode(brokerRes.trading_mode || walletRes.trading_mode || 'demo');
      setStartingBalance(String(walletRes.starting_balance || 1000000));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleModeChange(mode) {
    await setTradingMode(mode);
    setMode(mode);
  }

  async function handleResetWallet() {
    if (!confirm('⚠️ Reset demo wallet? This will clear all positions and trade history.')) return;
    await resetWallet(parseFloat(startingBalance));
    fetchData();
  }

  async function handleSaveBroker() {
    if (!editingBroker) return;
    const isFlattrade = editingBroker.id === 'flattrade';
    const win = isFlattrade ? window.open('', '_blank') : null;
    try {
      await saveBroker({ ...formData, id: editingBroker.id, name: editingBroker.name, broker_type: editingBroker.broker_type });
    } catch (e) {
      win?.close();
      throw e;
    }
    setEditingBroker(null);
    setFormData({});
    fetchData();
    if (isFlattrade) startFlattradeLogin(win);
  }

  function openBrokerConfig(template) {
    const existing = brokers.find(b => b.id === template.id);
    setEditingBroker(template);
    setFormData({
      ...(existing || {}),
      ...(template.id === 'flattrade' && !existing?.redirect_url ? { redirect_url: CALLBACK_URL } : {}),
    });
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Trading Mode Toggle */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={20} className="text-blue-600" />
          <h2 className="font-semibold text-slate-800 text-lg">Trading Mode</h2>
        </div>

        <div className="grid grid-cols-2 gap-4 max-w-lg">
          <button onClick={() => handleModeChange('demo')}
            className={`p-4 rounded-xl border-2 text-left transition ${tradingMode === 'demo' ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}>
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-3 h-3 rounded-full ${tradingMode === 'demo' ? 'bg-green-500' : 'bg-slate-300'}`} />
              <span className="font-semibold text-slate-800">Demo Wallet</span>
            </div>
            <p className="text-xs text-slate-500">Paper trading with virtual money. No real orders.</p>
          </button>

          <button onClick={() => handleModeChange('live')}
            className={`p-4 rounded-xl border-2 text-left transition ${tradingMode === 'live' ? 'border-red-500 bg-red-50' : 'border-slate-200 hover:border-slate-300'}`}>
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-3 h-3 rounded-full ${tradingMode === 'live' ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`} />
              <span className="font-semibold text-slate-800">Live Broker</span>
            </div>
            <p className="text-xs text-slate-500">Real orders via configured broker. Use with caution!</p>
          </button>
        </div>
      </div>

      {/* Demo Wallet Settings */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-800 text-lg mb-4">💰 Demo Wallet Settings</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-xs text-slate-500 font-medium">Starting Balance</div>
            <div className="text-xl font-bold text-slate-800">₹{fmt(wallet.starting_balance)}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-xs text-slate-500 font-medium">Current Cash</div>
            <div className="text-xl font-bold text-green-600">₹{fmt(wallet.cash_balance)}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-xs text-slate-500 font-medium">Total Value</div>
            <div className="text-xl font-bold text-blue-600">₹{fmt(wallet.total_value)}</div>
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Starting Balance (₹)</label>
            <input type="number" value={startingBalance} onChange={e => setStartingBalance(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-48" />
          </div>
          <button onClick={handleResetWallet}
            className="bg-red-100 hover:bg-red-200 text-red-700 rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1.5">
            <RotateCcw size={14} /> Reset Wallet
          </button>
        </div>
      </div>

      {/* Gemini AI */}
      <GeminiCard />

      {/* Broker Connections */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-800 text-lg mb-4">🔌 Broker Connections</h2>

        <div className="space-y-3">
          {BROKER_TEMPLATES.map(template => {
            const existing = brokers.find(b => b.id === template.id);
            const isConnected = existing?.is_connected;
            const hasConfig = existing?.api_key;

            return (
              <div key={template.id} className="border border-slate-200 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${hasConfig ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                    {template.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{template.name}</div>
                    <div className="flex items-center gap-1.5 text-xs">
                      {template.id === 'flattrade' && ftStatus && (
                        ftStatus.connected
                          ? <span className="text-green-600 font-medium">Live session active — prices from Flattrade</span>
                          : <span className="text-amber-600" title={ftStatus.error}>Session not active: {ftStatus.error}</span>
                      )}
                    </div>
                    {template.id === 'flattrade' && ftStatus && !ftStatus.connected && !hasConfig && (
                      <div className="text-xs text-slate-400">Click Configure, enter your API key and secret, then sign in on the Flattrade tab that opens.</div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs">
                      {hasConfig ? (
                        <><Wifi size={12} className="text-green-500" /><span className="text-green-600">Configured</span></>
                      ) : (
                        <><WifiOff size={12} className="text-slate-400" /><span className="text-slate-400">Not configured</span></>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {template.id === 'flattrade' && hasConfig && (
                    <button disabled={ftBusy} onClick={handleAuthenticate}
                      className="bg-green-100 hover:bg-green-200 disabled:opacity-50 text-green-700 rounded-lg px-4 py-2 text-sm font-medium">
                      {ftBusy ? 'Waiting for login...' : ftStatus?.connected ? 'Re-authenticate' : 'Authenticate'}
                    </button>
                  )}
                  <button onClick={() => openBrokerConfig(template)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1.5">
                  <Settings size={14} /> {hasConfig ? 'Edit' : 'Configure'}
                </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Broker Config Modal */}
      {editingBroker && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditingBroker(null)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg text-slate-800 mb-4">Configure {editingBroker.name}</h3>
            <div className="space-y-3">
              {editingBroker.fields.map(field => (
                <div key={field}>
                  <label className="text-xs font-medium text-slate-600 block mb-1">{field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</label>
                  <input
                    type={field.includes('secret') || field.includes('token') ? 'password' : 'text'}
                    value={formData[field] || ''}
                    onChange={e => setFormData({ ...formData, [field]: e.target.value })}
                    placeholder={`Enter ${field}`}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
              ))}
            </div>
            {editingBroker.id === 'flattrade' && (
              <p className="text-xs text-slate-500 mt-3">
                In your Flattrade API app, set the Redirect URL to <code className="bg-slate-100 px-1 rounded break-all">{CALLBACK_URL}</code>.
                After saving, a Flattrade login tab opens; once you sign in, the app receives the code, creates the token and stores it.
              </p>
            )}
            <div className="flex gap-2 mt-5">
              <button onClick={handleSaveBroker} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium">
                {editingBroker.id === 'flattrade' ? 'Save & Authenticate' : 'Save Configuration'}
              </button>
              <button onClick={() => setEditingBroker(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2 text-sm font-medium">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const AI_LABELS = { gemini: 'Gemini', openai: 'ChatGPT (OpenAI)', vscode: 'VS Code Copilot', ollama: 'Ollama (local)' };
const AI_IDS = Object.keys(AI_LABELS);

function GeminiCard() {
  const [settings, setSettings] = useState(null);
  const [tab, setTab] = useState('gemini');
  const [chain, setChain] = useState(['gemini']);
  const [secrets, setSecrets] = useState({ gemini: '', openai: '', vscode: '' });
  const [models, setModels] = useState({ gemini: '', openai: '', ollama: '' });
  const [vscodePort, setVscodePort] = useState(8765);
  const [ollamaUrl, setOllamaUrl] = useState('http://127.0.0.1:11434');
  const [enabled, setEnabled] = useState(false);
  const [maxCalls, setMaxCalls] = useState(20);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const apply = (s) => {
    setSettings(s);
    setChain(s.ai_chain);
    setModels({ gemini: s.gemini_model, openai: s.openai_model, ollama: s.ollama_model });
    setVscodePort(s.vscode_port);
    setOllamaUrl(s.ollama_url);
    setEnabled(!!s.ai_enabled);
    setMaxCalls(s.max_calls_per_hour);
  };

  useEffect(() => {
    getAiSettings().then(apply).catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);

  const configured = (p) => !!settings && (p === 'gemini' ? settings.has_gemini_key : p === 'openai' ? settings.has_openai_key : p === 'vscode' ? settings.has_vscode_token : true);
  const hints = settings && { gemini: settings.gemini_key_hint, openai: settings.openai_key_hint, vscode: settings.vscode_token_hint };

  const move = (i, d) => setChain((c) => { const n = [...c]; const j = i + d; if (j < 0 || j >= n.length) return c; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function save(extra = {}) {
    setBusy(true);
    setMsg(null);
    try {
      const entered = {};
      if (secrets.gemini) entered.gemini_api_key = secrets.gemini;
      if (secrets.openai) entered.openai_api_key = secrets.openai;
      if (secrets.vscode) entered.vscode_token = secrets.vscode;
      const s = await saveAiSettings({
        ai_chain: chain, gemini_model: models.gemini, openai_model: models.openai, ollama_model: models.ollama,
        ollama_url: ollamaUrl, vscode_port: Number(vscodePort), ai_enabled: enabled, max_calls_per_hour: Number(maxCalls),
        ...entered, ...extra,
      });
      apply(s);
      setSecrets({ gemini: '', openai: '', vscode: '' });
      setMsg({ ok: true, text: 'Saved' });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function test(provider) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await testAi(provider);
      setMsg({ ok: r.success, text: r.success ? `${AI_LABELS[r.provider] || 'AI'} answered` : 'Unexpected reply' });
      setSettings(await getAiSettings());
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return null;

  const secretField = { gemini: 'clear_api_key', openai: 'clear_openai_key', vscode: 'clear_vscode_token' }[tab];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-800 text-lg flex items-center gap-2"><Sparkles size={20} className="text-purple-600" /> AI Integration</h2>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
      </div>

      {/* Fallback order */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Fallback order (tried top to bottom when one is rate-limited or down)</h3>
        <ol className="space-y-1">
          {chain.map((p, i) => {
            const st = settings.provider_status?.[p];
            return (
              <li key={p} className="flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-1.5">
                <span className="text-slate-400 w-4">{i + 1}</span>
                <span className={`w-2 h-2 rounded-full ${!configured(p) ? 'bg-slate-300' : st?.ok === false ? 'bg-red-500' : st?.ok ? 'bg-green-500' : 'bg-amber-400'}`} />
                <span className="font-medium text-slate-800">{AI_LABELS[p]}</span>
                <span className="text-xs text-slate-400 truncate" title={st?.error || ''}>
                  {!configured(p) ? 'not configured' : st?.ok ? `answered ${new Date(st.at).toLocaleTimeString()}` : st?.error || 'not used yet'}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <button disabled={i === 0} onClick={() => move(i, -1)} className="px-1.5 text-slate-500 hover:text-slate-800 disabled:opacity-30" title="Move up">↑</button>
                  <button disabled={i === chain.length - 1} onClick={() => move(i, 1)} className="px-1.5 text-slate-500 hover:text-slate-800 disabled:opacity-30" title="Move down">↓</button>
                  <button disabled={chain.length === 1} onClick={() => setChain(chain.filter((x) => x !== p))} className="px-1.5 text-red-500 hover:text-red-700 disabled:opacity-30" title="Remove from order">✕</button>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-2 mt-2">
          {AI_IDS.filter((p) => !chain.includes(p)).map((p) => (
            <button key={p} onClick={() => setChain([...chain, p])} className="text-xs border border-dashed border-slate-300 rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-50">+ {AI_LABELS[p]}</button>
          ))}
        </div>
      </div>

      {/* Provider settings */}
      <div className="flex flex-wrap gap-2 mb-4">
        {AI_IDS.map((id) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${tab === id ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            {AI_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tab !== 'ollama' && (
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              {tab === 'vscode' ? 'Bridge token' : 'API key'} {configured(tab) && <span className="text-green-600">(saved {hints[tab]})</span>}
            </label>
            <input type="password" autoComplete="off" value={secrets[tab]} onChange={(e) => setSecrets({ ...secrets, [tab]: e.target.value })}
              placeholder={configured(tab) ? 'Leave blank to keep saved value' : tab === 'vscode' ? 'Run "AI Bridge: Copy Token" in VS Code, then paste' : `Paste ${AI_LABELS[tab]} API key`}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
          </div>
        )}
        {tab === 'vscode' && (
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Bridge port</label>
            <input type="number" min="1024" max="65535" value={vscodePort} onChange={(e) => setVscodePort(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        )}
        {tab === 'ollama' && (
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Ollama URL</label>
            <input type="text" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
          </div>
        )}
        {tab !== 'vscode' && (
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Model</label>
            <input type="text" value={models[tab]} onChange={(e) => setModels({ ...models, [tab]: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Max calls per hour (each provider)</label>
          <input type="number" min="1" max="1000" value={maxCalls} onChange={(e) => setMaxCalls(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-4">
        <button disabled={busy} onClick={() => save()} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">Save</button>
        <button disabled={busy || !configured(tab)} onClick={() => test(tab)}
          title="Tests the saved settings for this provider"
          className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium">{busy ? 'Working (up to 2 min)...' : `Test ${AI_LABELS[tab]}`}</button>
        <button disabled={busy} onClick={() => test()} className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium">Test fallback order</button>
        {secretField && configured(tab) && (
          <button disabled={busy} onClick={() => save({ [secretField]: true })} className="text-xs text-red-600 hover:underline">Remove saved {tab === 'vscode' ? 'token' : 'key'}</button>
        )}
        <span className="text-xs text-slate-400 ml-auto">Last answered by: {settings.last_used ? AI_LABELS[settings.last_used] : '—'} · {settings.calls_last_hour} calls in the last hour</span>
      </div>
      {msg && <p className={`text-sm mt-2 ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}

      <p className="text-xs text-slate-400 mt-3">
        {tab === 'gemini' && 'Free-tier keys have rate limits; the next provider in the order is used when Gemini is limited or busy.'}
        {tab === 'openai' && 'The ChatGPT app subscription does not include API access; the OpenAI API needs its own key and billing from platform.openai.com.'}
        {tab === 'vscode' && 'Uses your GitHub Copilot model through a local extension. In VS Code run "Developer: Install Extension from Location..." and pick the vscode-ai-bridge folder, then "AI Bridge: Copy Token". VS Code must stay open and signed in to Copilot.'}
        {tab === 'ollama' && 'Runs a model on this machine with no rate limit. Install Ollama, run "ollama pull llama3.1", and keep it running.'}
        {' '}Keys and tokens are stored on the server and never sent back to the browser.
      </p>
    </div>
  );
}
