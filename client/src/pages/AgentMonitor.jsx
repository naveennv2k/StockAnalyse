import { useState, useEffect, useCallback, useRef } from 'react';
import { getAgentLogs, getLessons, analyzeStocks, getWatchlist, getAutoTradeStatus, toggleAutoTrade, runAutoTradeNow, getAiSettings, getAvailableAiSkills, saveAiSettings } from '../services/api';
import { Bot, Brain, BookOpen, AlertTriangle, CheckCircle, XCircle, Play, RefreshCw } from 'lucide-react';

const AGENTS = [
  { id: 'data_analyser', name: 'Data Analyser', icon: '📈', description: 'Fetches market data, news, gainers/losers' },
  { id: 'outcome_analyser', name: 'Outcome Analysis', icon: '🧠', description: 'Predicts profit probability, BUY/SELL decision' },
  { id: 'order_placer', name: 'Order Placer', icon: '🛒', description: 'Executes trades via demo wallet or broker' },
  { id: 'correction', name: 'Correction Agent', icon: '🔄', description: 'Learns from losses, adjusts strategy' },
];

const formatIstTimestamp = (value) => {
  if (!value) return '-';
  const text = String(value);
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? text : new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'medium',
  }).format(date);
};

export default function AgentMonitor() {
  const [logs, setLogs] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [pipelineStatus, setPipelineStatus] = useState('idle'); // idle, running, done
  const [pipelineResults, setPipelineResults] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [logRes, lessonRes] = await Promise.all([getAgentLogs(), getLessons()]);
      setLogs(logRes.logs || []);
      setLessons(lessonRes.lessons || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const runPipeline = async () => {
    setPipelineStatus('running');
    setPipelineResults(null);
    try {
      const wl = await getWatchlist();
      const symbols = (wl.watchlist || []).map(w => w.symbol);
      if (!symbols.length) {
        setPipelineStatus('idle');
        return;
      }

      const results = await analyzeStocks(symbols, '5m');
      setPipelineResults(results);
      setPipelineStatus('done');
      fetchData(); // refresh logs
    } catch (err) {
      console.error(err);
      setPipelineStatus('idle');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <div className="space-y-6">
      <AutoTraderPanel onChange={fetchData} />

      {/* Pipeline Control */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-slate-800 text-lg flex items-center gap-2">
              <Bot size={22} className="text-purple-600" /> Agent Pipeline
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Multi-agent analysis → decision → execution flow</p>
          </div>
          <button onClick={runPipeline} disabled={pipelineStatus === 'running'}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg px-5 py-2.5 text-sm font-medium flex items-center gap-2 disabled:opacity-50 shadow-sm">
            {pipelineStatus === 'running' ? (
              <><RefreshCw size={16} className="animate-spin" /> Running Pipeline...</>
            ) : (
              <><Play size={16} /> Run Pipeline</>
            )}
          </button>
        </div>

        {/* Agent Cards - Pipeline Visualization */}
        <div className="flex flex-col md:flex-row items-stretch gap-3">
          {AGENTS.map((agent, idx) => {
            const isActive = pipelineStatus === 'running' && idx <= 1;
            const isDone = pipelineStatus === 'done';
            const statusColor = isActive ? 'border-yellow-400 bg-yellow-50' : isDone ? 'border-green-400 bg-green-50' : 'border-slate-200';
            const statusIcon = isActive ? '⏳' : isDone ? '✅' : '⏹';

            return (
              <div key={agent.id} className="flex items-center gap-2 flex-1">
                <div className={`border-2 rounded-xl p-4 flex-1 transition-all ${statusColor}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{agent.icon}</span>
                    <span className="font-semibold text-sm text-slate-800">{agent.name}</span>
                  </div>
                  <p className="text-xs text-slate-500">{agent.description}</p>
                  <div className="mt-2 text-xs font-medium text-slate-400">{statusIcon} {isActive ? 'Running' : isDone ? 'Complete' : 'Idle'}</div>
                </div>
                {idx < AGENTS.length - 1 && (
                  <span className="text-slate-300 text-lg hidden md:block">→</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pipeline Results */}
      {pipelineResults && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <Brain size={18} className="text-purple-600" /> Pipeline Results
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(pipelineResults.results || pipelineResults || []).map((r, i) => {
              const v = r.verdict;
              const bg = v === 'BUY' ? 'bg-green-50 border-green-200' : v === 'SELL' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200';
              const badge = v === 'BUY' ? 'bg-green-500' : v === 'SELL' ? 'bg-red-500' : 'bg-yellow-500';
              return (
                <div key={i} className={`border rounded-lg p-3 ${bg}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-800 text-sm">{r.symbol}</span>
                    <span className={`${badge} text-white text-xs font-bold px-2 py-0.5 rounded-full`}>{v}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>₹{r.ltp}</span>
                    <span>•</span>
                    <span>Confidence: {r.confidence}%</span>
                    <span>•</span>
                    <span>{r.risk_level} risk</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lessons from Correction Agent */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <BookOpen size={18} className="text-orange-600" /> Learned Lessons ({lessons.length})
        </h3>
        {lessons.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">
            No outcome lessons yet. Profitable exits, losses, and skipped setups that would have hit target are recorded here.
          </p>
        ) : (
          <div className="space-y-2">
            {lessons.map((l, i) => (
              <div key={i} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle size={14} className="text-orange-500" />
                  <span className="font-medium text-sm text-slate-800">{l.symbol} — {{ auto_trade_loss: 'Loss lesson', auto_trade_win: 'Win lesson', missed_opportunity: 'Missed opportunity' }[l.lesson_type] || l.lesson_type}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${l.severity === 'high' ? 'bg-red-100 text-red-700' : l.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                    {l.severity}
                  </span>
                </div>
                <p className="text-xs text-slate-600">{l.what_happened}</p>
                {l.why_it_failed && <p className="text-xs text-slate-500 mt-0.5">{l.why_it_failed}</p>}
                <p className="text-xs text-slate-500 mt-0.5">📝 Rule: <span className="font-medium">{l.rule_learned}</span></p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Activity Log */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            📋 Agent Activity Log
          </h3>
          <button onClick={fetchData} className="text-slate-400 hover:text-slate-600"><RefreshCw size={16} /></button>
        </div>
        <div className="max-h-80 overflow-y-auto space-y-1">
          {logs.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No agent activity yet.</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-slate-50">
                <span className="text-slate-300 font-mono w-44 flex-shrink-0">{formatIstTimestamp(log.created_at)}</span>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${log.status === 'success' ? 'bg-green-500' : log.status === 'error' ? 'bg-red-500' : 'bg-blue-400'}`} />
                <span className="text-slate-500 w-24 flex-shrink-0 font-medium">{log.agent_name}</span>
                <span className="text-slate-700">{log.action}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const RISK_FIELDS = [
  { key: 'position_pct', label: 'Position size (% of wallet)', min: 1, max: 25 },
  { key: 'max_positions', label: 'Max open positions', min: 1, max: 20 },
  { key: 'candidate_min_confidence', label: 'Scanner min confidence', min: 0, max: 100 },
  { key: 'ai_min_confidence', label: 'AI min confidence', min: 0, max: 100 },
];

function AutoTraderPanel({ onChange }) {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [risk, setRisk] = useState({});
  const [instructions, setInstructions] = useState('');
  const instructionsDirty = useRef(false);
  const [skills, setSkills] = useState([]);
  const skillsDirty = useRef(false);
  const [repoSkillCatalog, setRepoSkillCatalog] = useState([]);
  const [repoSkillIds, setRepoSkillIds] = useState([]);
  const repoSkillsDirty = useRef(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const [st, se, catalog] = await Promise.all([getAutoTradeStatus(), getAiSettings(), getAvailableAiSkills()]);
      setStatus(st);
      setSettings(se);
      setRepoSkillCatalog(catalog.skills || []);
      setRisk((r) => (Object.keys(r).length ? r : Object.fromEntries(RISK_FIELDS.map((f) => [f.key, se[f.key]]))));
      if (!instructionsDirty.current) setInstructions(se.trading_instructions || '');
      if (!skillsDirty.current) setSkills(se.trading_skills || []);
      if (!repoSkillsDirty.current) setRepoSkillIds(se.trading_skill_ids || []);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const act = async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: !r?.skipped, text: r?.skipped || okText(r) });
      await load();
      onChange?.();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  if (!status || !settings) return null;
  const s = status.stats;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-slate-800 text-lg flex items-center gap-2"><Bot size={22} className="text-green-600" /> Auto Trader (demo wallet)</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Watchlist picks → the AI ({(settings.ai_chain || []).map((p) => ({ gemini: 'Gemini', openai: 'ChatGPT', vscode: 'Copilot', ollama: 'Ollama' }[p])).join(' \u2192 ')}) decides using indicators, news and past lessons → demo order with stop-loss, target and 3:15 PM square-off.
            Market is {status.market_open ? 'open' : 'closed'}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={busy || !settings.ai_enabled} onClick={() => act(runAutoTradeNow, (r) => `Run finished: ${r.opened.length} opened, ${r.closed.length} closed, ${r.skipped.length} skipped${r.errors.length ? `, errors: ${r.errors.join('; ')}` : ''}`)}
            className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1.5">
            <Play size={14} /> Run now
          </button>
          <button disabled={busy} onClick={() => act(() => toggleAutoTrade(!status.enabled), (r) => (r.enabled ? 'Auto-trading on' : 'Auto-trading off'))}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${status.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>
            {status.enabled ? 'Stop auto-trading' : 'Start auto-trading'}
          </button>
        </div>
      </div>

      {!settings.ai_enabled && <p className="text-sm text-amber-600 mb-3">AI is not enabled. Add your Gemini or ChatGPT key on the Integrations page.</p>}
      {msg && <p className={`text-sm mb-3 ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}

      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 mb-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${status.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{status.enabled ? 'ON' : 'OFF'}</span>
        <span>
          {!status.enabled && 'Auto-trading is off.'}
          {status.enabled && status.running && 'Running a cycle...'}
          {status.enabled && !status.running && !status.market_open && 'Waiting for market hours (Mon–Fri, 9:15–15:30 IST; new entries 9:15–14:45). Use "Run now" to test with the last session\'s prices.'}
          {status.enabled && !status.running && status.market_open && !status.entry_window_open && 'Market is open, but the new-entry window has closed at 14:45 IST. Open positions are still monitored.'}
          {status.enabled && !status.running && status.entry_window_open && `Entry window open — watchlist and AI opportunities checked every minute; position prices are checked ${status.live_feed?.connected ? 'from the Flattrade stream every second' : 'by fallback polling about every 15 seconds'}.`}
        </span>
        {status.enabled && status.entry_window_open && (
          <span className={`text-xs ${status.live_feed?.connected ? 'text-green-600' : 'text-amber-600'}`} title={status.live_feed?.error || ''}>
            {status.live_feed?.connected ? `Flattrade stream: ${status.live_feed.subscribed_symbols} symbols` : `Live feed unavailable; price checks use fallback polling${status.live_feed?.error ? ` (${status.live_feed.error})` : ''}`}
          </span>
        )}
        {status.last_run && (
          <span className="text-xs text-slate-400">
            Last run {formatIstTimestamp(status.last_run)} IST: {status.last_summary ? `${status.last_summary.opened.length} opened, ${status.last_summary.closed.length} closed, ${status.last_summary.skipped.length} skipped${status.last_summary.errors.length ? `, errors: ${status.last_summary.errors.join('; ')}` : ''}` : ''}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {[
          ['Decisions', s.decisions],
          ['Executed', s.executed],
          ['Win rate', s.win_rate != null ? `${s.win_rate}%` : '-'],
          ['W / L', `${s.wins} / ${s.losses}`],
          ['Realized P&L', `\u20b9${s.total_pnl}`],
        ].map(([label, value]) => (
          <div key={label} className="bg-slate-50 rounded-lg px-3 py-2">
            <div className="text-[10px] uppercase text-slate-400">{label}</div>
            <div className="font-semibold text-slate-800">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end mb-4">
        {RISK_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="text-xs font-medium text-slate-600 block mb-1">{f.label}</label>
            <input type="number" min={f.min} max={f.max} value={risk[f.key] ?? ''} onChange={(e) => setRisk({ ...risk, [f.key]: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
        ))}
      </div>

      <div className="mb-4">
        <label htmlFor="auto-trade-instructions" className="text-xs font-medium text-slate-600 block mb-1">Trade instructions for the AI</label>
        <textarea
          id="auto-trade-instructions"
          value={instructions}
          maxLength={1500}
          rows={3}
          onChange={(e) => { instructionsDirty.current = true; setInstructions(e.target.value); }}
          placeholder="Add strategy preferences the AI should consider when deciding BUY, SELL, or SKIP."
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-y"
        />
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-slate-400">Advisory only. Cannot override demo-only execution, confidence limits, position limits, or 2% stop / 4% target.</p>
          <span className="text-xs text-slate-400">{instructions.length}/1500</span>
        </div>
      </div>
      <div className="flex justify-end mb-4">
        <button disabled={busy} onClick={() => act(
          () => saveAiSettings({
            ...Object.fromEntries(Object.entries(risk).map(([k, v]) => [k, Number(v)])),
            trading_instructions: instructions,
            trading_skills: skills,
            trading_skill_ids: repoSkillIds,
          }),
          () => { instructionsDirty.current = false; skillsDirty.current = false; repoSkillsDirty.current = false; return 'Risk limits, instructions, and skills saved'; },
        )}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-1.5 text-sm font-medium">Save limits &amp; instructions</button>
      </div>

      <div className="mb-5 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Skills from .skills</h3>
        <p className="text-xs text-slate-400 mb-3">Select repository playbooks to include in prompts sent to any AI provider. App risk and execution rules always take precedence.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {repoSkillCatalog.filter((skill) => skill.available).map((skill) => (
            <label key={skill.id} className="flex items-start gap-2 border border-slate-200 rounded-lg p-2.5 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={repoSkillIds.includes(skill.id)}
                onChange={(e) => {
                  repoSkillsDirty.current = true;
                  setRepoSkillIds((ids) => e.target.checked ? [...ids, skill.id] : ids.filter((id) => id !== skill.id));
                }}
              />
              <span>
                <span className="block text-xs font-medium text-slate-700">{skill.name}</span>
                <span className="block text-[11px] text-slate-400">{skill.description}</span>
              </span>
            </label>
          ))}
        </div>
        {!repoSkillCatalog.some((skill) => skill.available) && <p className="text-xs text-amber-600">No repository skills found. Check that the .skills directory is present.</p>}
      </div>

      <div className="mb-5 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Trading skills</h3>
            <p className="text-xs text-slate-400">Enabled skills guide every configured AI provider. They are reusable across trading modes and cannot override app risk controls.</p>
          </div>
          <button disabled={skills.length >= 10} onClick={() => {
            skillsDirty.current = true;
            setSkills([...skills, { id: globalThis.crypto?.randomUUID?.() || `skill-${Date.now()}`, name: '', instructions: '', enabled: true }]);
          }} className="shrink-0 border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">+ Add skill</button>
        </div>
        <div className="space-y-3">
          {skills.map((skill, i) => (
            <div key={skill.id} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <input type="checkbox" checked={skill.enabled} aria-label={`Enable ${skill.name || `skill ${i + 1}`}`} onChange={(e) => {
                  skillsDirty.current = true;
                  setSkills(skills.map((s) => s.id === skill.id ? { ...s, enabled: e.target.checked } : s));
                }} />
                <input type="text" maxLength={60} value={skill.name} placeholder="Skill name, e.g. VWAP trend confirmation" onChange={(e) => {
                  skillsDirty.current = true;
                  setSkills(skills.map((s) => s.id === skill.id ? { ...s, name: e.target.value } : s));
                }} className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium" />
                <button onClick={() => { skillsDirty.current = true; setSkills(skills.filter((s) => s.id !== skill.id)); }} className="px-2 text-red-600 hover:text-red-800" title="Remove skill">Remove</button>
              </div>
              <textarea rows={2} maxLength={1000} value={skill.instructions} placeholder="Describe the conditions and behavior for this strategy skill." onChange={(e) => {
                skillsDirty.current = true;
                setSkills(skills.map((s) => s.id === skill.id ? { ...s, instructions: e.target.value } : s));
              }} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-y" />
              <div className="text-right text-[10px] text-slate-400">{skill.instructions.length}/1000</div>
            </div>
          ))}
          {!skills.length && <p className="text-xs text-slate-400">No skills added. Use “Add skill” to create a named strategy guide.</p>}
        </div>
        <div className="flex justify-end mt-3">
          <button disabled={busy} onClick={() => act(
            () => saveAiSettings({ trading_skills: skills, trading_skill_ids: repoSkillIds }),
            () => { skillsDirty.current = false; repoSkillsDirty.current = false; return 'Trading skills saved'; },
          )} className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg px-4 py-1.5 text-sm font-medium">Save skills</button>
        </div>
      </div>

      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Recent AI decisions</h3>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {status.decisions.length === 0 && <p className="text-sm text-slate-400 py-3 text-center">No decisions yet.</p>}
        {status.decisions.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-slate-50">
            <span className="text-slate-300 font-mono w-44 flex-shrink-0">{formatIstTimestamp(d.created_at)}</span>
            <span className="font-semibold w-24 flex-shrink-0 text-slate-800">{d.symbol}</span>
            <span className={`w-12 flex-shrink-0 font-bold ${d.action === 'BUY' ? 'text-green-600' : d.action === 'SELL' ? 'text-red-600' : 'text-slate-400'}`}>{d.action}</span>
            <span className="w-10 flex-shrink-0 text-slate-500">{d.confidence}%</span>
            <span className="text-slate-600 flex-1 truncate" title={d.reason}>{d.reason}</span>
            <span className={`flex-shrink-0 ${d.outcome_pnl > 0 ? 'text-green-600' : d.outcome_pnl < 0 ? 'text-red-600' : 'text-slate-400'}`}>
              {d.executed ? (d.closed_at ? `\u20b9${d.outcome_pnl}` : 'open') : 'not traded'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
