import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = path.join(__dirname, '..', '..', '.skills');
const MAX_SKILL_CHARS = 2200;
const MAX_TOTAL_CHARS = 8500;

const DEFINITIONS = [
  { id: 'nse-trading-toolkit', name: 'NSE Trading Toolkit', description: 'Orchestrates a complete NSE/BSE stock analysis and action plan.' },
  { id: 'technical-analysis', name: 'Technical Analysis', description: 'Trend, support/resistance, volume and indicator confluence.' },
  { id: 'position-sizing', name: 'Position Sizing', description: 'Risk-based sizing methods and portfolio constraints.' },
  { id: 'stop-loss-strategies', name: 'Stop-Loss Strategies', description: 'Structure, ATR, support/resistance and moving-average stops.' },
  { id: 'trailing-stops', name: 'Trailing Stops', description: 'Methods for protecting gains as a trade moves favorably.' },
  { id: 'risk-reward-ratio', name: 'Risk-Reward Ratio', description: 'R:R filtering, breakeven win rates and expected value.' },
  { id: 'multi-timeframe-analysis', name: 'Multi-Timeframe Analysis', description: 'Higher-timeframe bias and lower-timeframe entry context.' },
  { id: 'rsi-divergence', name: 'RSI Divergence', description: 'Regular and hidden RSI divergence with confirmation.' },
  { id: 'fibonacci-trading', name: 'Fibonacci Trading', description: 'Retracement, extension and confluence zones.' },
];

const BY_ID = new Map(DEFINITIONS.map((item) => [item.id, item]));

export function listTradingSkills() {
  return DEFINITIONS.map(({ id, name, description }) => ({
    id,
    name,
    description,
    available: fs.existsSync(path.join(SKILLS_ROOT, id, 'SKILL.md')),
  }));
}

export function normalizeTradingSkillIds(ids) {
  if (!Array.isArray(ids)) throw new Error('trading_skill_ids must be a list');
  if (ids.length > DEFINITIONS.length) throw new Error('Too many repository skills selected');
  return [...new Set(ids.map(String))].filter((id) => BY_ID.has(id));
}

export function loadTradingSkillContext(ids) {
  const sections = [];
  let remaining = MAX_TOTAL_CHARS;

  for (const id of normalizeTradingSkillIds(ids)) {
    if (remaining <= 0) break;
    const skill = BY_ID.get(id);
    const file = path.join(SKILLS_ROOT, id, 'SKILL.md');
    let body;
    try { body = fs.readFileSync(file, 'utf8'); } catch { continue; }
    body = body.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim();
    body = body.replace(/\u0000/g, '').slice(0, Math.min(MAX_SKILL_CHARS, remaining));
    if (!body) continue;
    sections.push(`### ${skill.name}\n${body}`);
    remaining -= body.length;
  }
  return sections.join('\n\n');
}
