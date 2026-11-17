import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'trades.db');

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Wallet / Account
    CREATE TABLE IF NOT EXISTS wallet (
      id INTEGER PRIMARY KEY DEFAULT 1,
      starting_balance REAL NOT NULL DEFAULT 1000000,
      cash_balance REAL NOT NULL DEFAULT 1000000,
      trading_mode TEXT NOT NULL DEFAULT 'demo',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Broker configurations
    CREATE TABLE IF NOT EXISTS brokers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      broker_type TEXT NOT NULL,
      api_key TEXT,
      api_secret TEXT,
      user_id TEXT,
      user_token TEXT,
      redirect_url TEXT,
      is_active INTEGER DEFAULT 0,
      is_connected INTEGER DEFAULT 0,
      config_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Trades (both demo and live)
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL DEFAULT 'NSE',
      side TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      order_type TEXT NOT NULL DEFAULT 'MARKET',
      product_type TEXT NOT NULL DEFAULT 'MIS',
      status TEXT NOT NULL DEFAULT 'PENDING',
      fill_price REAL,
      fill_time TEXT,
      broker_order_id TEXT,
      trading_mode TEXT NOT NULL DEFAULT 'demo',
      remarks TEXT,
      agent_verdict TEXT,
      agent_confidence INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Positions (aggregated from trades)
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL DEFAULT 'NSE',
      quantity INTEGER NOT NULL DEFAULT 0,
      avg_price REAL NOT NULL DEFAULT 0,
      current_price REAL DEFAULT 0,
      pnl REAL DEFAULT 0,
      product_type TEXT NOT NULL DEFAULT 'MIS',
      trading_mode TEXT NOT NULL DEFAULT 'demo',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(symbol, exchange, product_type, trading_mode)
    );

    -- Watchlist
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      exchange TEXT NOT NULL DEFAULT 'NSE',
      added_at TEXT DEFAULT (datetime('now'))
    );

    -- Agent lessons (Correction Agent memory)
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT,
      symbol TEXT NOT NULL,
      lesson_type TEXT NOT NULL,
      what_happened TEXT NOT NULL,
      why_it_failed TEXT,
      rule_learned TEXT NOT NULL,
      severity TEXT DEFAULT 'medium',
      times_applied INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(trade_id) REFERENCES trades(id)
    );

    -- Agent run logs
    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      status TEXT DEFAULT 'info',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Gemini AI + auto-trader settings (single row)
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      gemini_api_key TEXT NOT NULL DEFAULT '',
      gemini_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
      ai_enabled INTEGER NOT NULL DEFAULT 0,
      max_calls_per_hour INTEGER NOT NULL DEFAULT 20,
      auto_trade_enabled INTEGER NOT NULL DEFAULT 0,
      position_pct REAL NOT NULL DEFAULT 10,
      max_positions INTEGER NOT NULL DEFAULT 5,
      candidate_min_confidence INTEGER NOT NULL DEFAULT 50,
      ai_min_confidence INTEGER NOT NULL DEFAULT 30,
      trading_instructions TEXT NOT NULL DEFAULT '',
      trading_skills TEXT NOT NULL DEFAULT '[]',
      trading_skill_ids TEXT NOT NULL DEFAULT '["technical-analysis","risk-reward-ratio"]',
      auto_trade_universe TEXT NOT NULL DEFAULT 'watchlist'
    );
    INSERT OR IGNORE INTO ai_settings (id) VALUES (1);

    -- Every Gemini trade decision and its eventual outcome
    CREATE TABLE IF NOT EXISTS ai_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL,
      confidence INTEGER,
      reason TEXT,
      scanner_verdict TEXT,
      scanner_confidence INTEGER,
      news_label TEXT,
      executed INTEGER NOT NULL DEFAULT 0,
      trade_id TEXT,
      pattern_name TEXT,
      pattern_zone_anchor REAL,
      pattern_zone_tolerance REAL,
      pattern_target1 REAL,
      pattern_target2 REAL,
      pattern_stop REAL,
      outcome_pnl REAL,
      closed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_live_orders (
      decision_id INTEGER PRIMARY KEY,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      entry_order_id TEXT NOT NULL,
      entry_status TEXT NOT NULL DEFAULT 'SUBMITTED',
      entry_filled_quantity INTEGER NOT NULL DEFAULT 0,
      entry_price REAL,
      stop_loss REAL NOT NULL,
      target REAL NOT NULL,
      exit_order_id TEXT,
      exit_status TEXT,
      exit_filled_quantity INTEGER NOT NULL DEFAULT 0,
      exit_price REAL,
      closed_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(decision_id) REFERENCES ai_decisions(id)
    );

    CREATE TABLE IF NOT EXISTS ai_side_evaluations (
      decision_id INTEGER NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
      symbol TEXT NOT NULL,
      raw_score INTEGER,
      feature_snapshot TEXT NOT NULL DEFAULT '{}',
      entry_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      stop_price REAL NOT NULL,
      target_price REAL NOT NULL,
      exchange TEXT NOT NULL DEFAULT 'NSE',
      market_mode TEXT NOT NULL DEFAULT 'demo',
      market_source TEXT NOT NULL DEFAULT 'unknown',
      slippage_bps INTEGER NOT NULL DEFAULT 5,
      outcome_status TEXT NOT NULL DEFAULT 'pending',
      outcome_label INTEGER,
      exit_reason TEXT,
      exit_price REAL,
      gross_pnl REAL,
      estimated_fees REAL,
      estimated_slippage REAL,
      net_pnl REAL,
      outcome_source TEXT,
      sampled_at TEXT NOT NULL DEFAULT (datetime('now')),
      evaluated_at TEXT,
      PRIMARY KEY (decision_id, side),
      FOREIGN KEY (decision_id) REFERENCES ai_decisions(id)
    );

    CREATE TABLE IF NOT EXISTS ai_daily_risk_locks (
      session_date TEXT PRIMARY KEY,
      trading_mode TEXT NOT NULL,
      realized_pnl REAL NOT NULL DEFAULT 0,
      unrealized_pnl REAL NOT NULL DEFAULT 0,
      capital REAL NOT NULL,
      locked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_pattern_zone_strikes (
      session_date TEXT NOT NULL,
      symbol TEXT NOT NULL,
      pattern_name TEXT NOT NULL,
      zone_anchor REAL NOT NULL,
      zone_tolerance REAL NOT NULL,
      stop_count INTEGER NOT NULL DEFAULT 0,
      locked_at TEXT,
      last_decision_id INTEGER,
      PRIMARY KEY (session_date, symbol, pattern_name, zone_anchor)
    );

    -- Insert default wallet if not exists
    INSERT OR IGNORE INTO wallet (id, starting_balance, cash_balance) 
    VALUES (1, 1000000, 1000000);

    -- Insert default watchlist
    INSERT OR IGNORE INTO watchlist (symbol, exchange) VALUES ('RELIANCE', 'NSE');
    INSERT OR IGNORE INTO watchlist (symbol, exchange) VALUES ('TCS', 'NSE');
    INSERT OR IGNORE INTO watchlist (symbol, exchange) VALUES ('INFY', 'NSE');
    INSERT OR IGNORE INTO watchlist (symbol, exchange) VALUES ('HDFCBANK', 'NSE');
    INSERT OR IGNORE INTO watchlist (symbol, exchange) VALUES ('SBIN', 'NSE');
    INSERT OR IGNORE INTO watchlist (symbol, exchange) VALUES ('ICICIBANK', 'NSE');
    INSERT OR IGNORE INTO watchlist (symbol, exchange) VALUES ('ITC', 'NSE');
    INSERT OR IGNORE INTO watchlist (symbol, exchange) VALUES ('AXISBANK', 'NSE');
    INSERT OR IGNORE INTO watchlist (symbol, exchange) VALUES ('KOTAKBANK', 'NSE');
    INSERT OR IGNORE INTO watchlist (symbol, exchange) VALUES ('LT', 'NSE');
  `);

  addColumn('trades', 'realized_pnl', 'REAL');
  addColumn('trades', 'gross_realized_pnl', 'REAL NOT NULL DEFAULT 0');
  addColumn('trades', 'charges', 'REAL NOT NULL DEFAULT 0');
  addColumn('trades', 'charge_breakdown', `TEXT NOT NULL DEFAULT '{}'`);
  addColumn('ai_decisions', 'reference_action', 'TEXT');
  addColumn('ai_decisions', 'reference_price', 'REAL');
  addColumn('ai_decisions', 'reference_target', 'REAL');
  addColumn('ai_decisions', 'reference_stop', 'REAL');
  addColumn('ai_decisions', 'evaluated_at', 'TEXT');
  addColumn('ai_decisions', 'opportunity_result', 'TEXT');
  addColumn('ai_decisions', 'pattern_name', 'TEXT');
  addColumn('ai_decisions', 'pattern_zone_anchor', 'REAL');
  addColumn('ai_decisions', 'pattern_zone_tolerance', 'REAL');
  addColumn('ai_decisions', 'pattern_target1', 'REAL');
  addColumn('ai_decisions', 'pattern_target2', 'REAL');
  addColumn('ai_decisions', 'pattern_stop', 'REAL');
  addColumn('ai_live_orders', 'target1', 'REAL');
  addColumn('ai_live_orders', 'target1_order_id', 'TEXT');
  addColumn('ai_live_orders', 'target1_status', 'TEXT');
  addColumn('ai_live_orders', 'target1_filled_quantity', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('ai_live_orders', 'target1_exit_price', 'REAL');
  addColumn('ai_live_orders', 'target1_done', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('ai_live_orders', 'stop_order_id', 'TEXT');
  addColumn('ai_live_orders', 'stop_status', 'TEXT');
  addColumn('ai_live_orders', 'stop_remarks', 'TEXT');
  addColumn('ai_live_orders', 'pattern_name', 'TEXT');
  addColumn('ai_live_orders', 'pattern_zone_anchor', 'REAL');
  addColumn('ai_live_orders', 'pattern_zone_tolerance', 'REAL');
  addColumn('ai_live_orders', 'exit_reason', 'TEXT');
  addColumn('ai_live_orders', 'atr_value', 'REAL');
  addColumn('ai_live_orders', 'highest_price', 'REAL');
  addColumn('ai_live_orders', 'lowest_price', 'REAL');
  addColumn('positions', 'target1', 'REAL');
  addColumn('positions', 'target1_hit', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('positions', 'atr_value', 'REAL');
  addColumn('positions', 'highest_price', 'REAL');
  addColumn('positions', 'lowest_price', 'REAL');
  addColumn('ai_settings', 'ai_provider', `TEXT NOT NULL DEFAULT 'gemini'`);
  addColumn('ai_settings', 'openai_api_key', `TEXT NOT NULL DEFAULT ''`);
  addColumn('ai_settings', 'openai_model', `TEXT NOT NULL DEFAULT 'gpt-4o-mini'`);
  addColumn('ai_settings', 'ai_chain', `TEXT NOT NULL DEFAULT ''`);
  addColumn('ai_settings', 'vscode_port', `INTEGER NOT NULL DEFAULT 8765`);
  addColumn('ai_settings', 'vscode_token', `TEXT NOT NULL DEFAULT ''`);
  addColumn('ai_settings', 'ollama_url', `TEXT NOT NULL DEFAULT 'http://127.0.0.1:11434'`);
  addColumn('ai_settings', 'ollama_model', `TEXT NOT NULL DEFAULT 'llama3.1'`);
  addColumn('ai_settings', 'trading_instructions', `TEXT NOT NULL DEFAULT ''`);
  addColumn('ai_settings', 'trading_skills', `TEXT NOT NULL DEFAULT '[]'`);
  addColumn('ai_settings', 'trading_skill_ids', `TEXT NOT NULL DEFAULT '["technical-analysis","risk-reward-ratio"]'`);
  addColumn('ai_settings', 'auto_trade_universe', `TEXT NOT NULL DEFAULT 'watchlist'`);
  addColumn('positions', 'stop_loss', 'REAL');
  addColumn('positions', 'target', 'REAL');
  addColumn('positions', 'decision_id', 'INTEGER');
  addColumn('positions', 'open_charges', 'REAL NOT NULL DEFAULT 0');
  db.prepare(`UPDATE trades SET gross_realized_pnl = realized_pnl WHERE gross_realized_pnl = 0 AND COALESCE(realized_pnl, 0) != 0 AND charges = 0`).run();

  console.log('✅ Database initialized');
}

function addColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export default getDb;
