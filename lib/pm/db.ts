import { DatabaseSync, StatementSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Local analytics store. Node's built-in SQLite, no native deps.
 * Path: $POLYGLOTH_DB or <repo>/data/polygloth.sqlite. Use ':memory:' in tests.
 */
export const DB_PATH = process.env.POLYGLOTH_DB || path.resolve(process.cwd(), 'data', 'polygloth.sqlite');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  username TEXT,
  first_trade_ts INTEGER,
  last_trade_ts INTEGER,
  trade_count INTEGER DEFAULT 0,
  lb_rank_pnl_month INTEGER,
  lb_pnl_month REAL,
  lb_vol_month REAL,
  lb_rank_vol_all INTEGER,
  lb_pnl_all REAL,
  lb_vol_all REAL,
  source TEXT,                       -- leaderboard | market | comment | manual
  trades_ingested_at INTEGER,
  trades_complete INTEGER DEFAULT 0, -- 1 when history was fully paged
  notes TEXT
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,               -- txHash:asset:side:size:price:wallet
  wallet TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  outcome_index INTEGER NOT NULL,
  outcome TEXT,
  side TEXT NOT NULL,                -- BUY | SELL
  size REAL NOT NULL,
  price REAL NOT NULL,
  usdc REAL NOT NULL,
  ts INTEGER NOT NULL,
  event_slug TEXT,
  market_slug TEXT,
  title TEXT,
  asset TEXT,
  tx_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_trades_wallet_ts ON trades(wallet, ts DESC);
CREATE INDEX IF NOT EXISTS idx_trades_market_ts ON trades(condition_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts DESC);

CREATE TABLE IF NOT EXISTS markets (
  condition_id TEXT PRIMARY KEY,
  gamma_id TEXT,
  event_id TEXT,
  event_slug TEXT,
  market_slug TEXT,
  question TEXT,
  description TEXT,
  outcomes TEXT,                     -- JSON array
  clob_token_ids TEXT,               -- JSON array
  category TEXT,
  neg_risk INTEGER DEFAULT 0,
  is_sports INTEGER DEFAULT 0,
  volume REAL, volume24hr REAL, liquidity REAL,
  yes_price REAL, best_bid REAL, best_ask REAL, spread REAL,
  start_ts INTEGER, end_ts INTEGER,
  active INTEGER, closed INTEGER,
  winner_index INTEGER,              -- NULL until resolved
  resolved INTEGER DEFAULT 0,
  resolution_checked_at INTEGER,
  resolution_source TEXT,
  uma_status TEXT,
  description_hash TEXT,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_markets_event ON markets(event_slug);
CREATE INDEX IF NOT EXISTS idx_markets_end ON markets(end_ts);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  title TEXT,
  tags TEXT,                         -- JSON array of labels
  category TEXT,
  neg_risk INTEGER DEFAULT 0,
  comment_count INTEGER,
  volume REAL, volume24hr REAL, liquidity REAL, open_interest REAL,
  end_ts INTEGER, active INTEGER, closed INTEGER,
  resolution_source TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  body TEXT,
  user_address TEXT,
  proxy_wallet TEXT,
  name TEXT,
  created_ts INTEGER,
  reaction_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_comments_event_ts ON comments(event_id, created_ts DESC);

CREATE TABLE IF NOT EXISTS prices (
  token_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (token_id, ts)
);

CREATE TABLE IF NOT EXISTS book_snapshots (
  token_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  best_bid REAL, best_ask REAL, mid REAL, spread REAL,
  depth_bid_1c REAL, depth_ask_1c REAL, depth_bid_5c REAL, depth_ask_5c REAL,
  bids TEXT, asks TEXT,              -- JSON top 20 levels
  PRIMARY KEY (token_id, ts)
);

CREATE TABLE IF NOT EXISTS position_snapshots (
  wallet TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  outcome_index INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  size REAL, avg_price REAL, cur_price REAL, initial_value REAL, current_value REAL, cash_pnl REAL,
  PRIMARY KEY (wallet, condition_id, outcome_index, ts)
);

CREATE TABLE IF NOT EXISTS kalshi_markets (
  ticker TEXT PRIMARY KEY,
  event_ticker TEXT, series_ticker TEXT,
  title TEXT, subtitle TEXT, status TEXT,
  yes_bid REAL, yes_ask REAL, no_bid REAL, no_ask REAL, last_price REAL,
  volume REAL, volume24h REAL, open_interest REAL,
  close_ts INTEGER, rules TEXT, result TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS wallet_scores (
  wallet TEXT NOT NULL,
  category TEXT NOT NULL,            -- 'all' or a Category
  window_days INTEGER NOT NULL,      -- 0 = all time
  n_markets INTEGER, n_resolved INTEGER, wins INTEGER,
  staked REAL, pnl REAL, roi REAL,
  calibrated_roi REAL,               -- pnl / expected-variance-adjusted stake (see wallet-score.ts)
  brier REAL,
  avg_entry_price REAL,
  longshot_share REAL, favorite_share REAL,
  p_value REAL,                      -- binomial test vs price-implied expectation
  entry_timing REAL,                 -- mean favourable move (pp) 24h after entry
  conviction_sigma REAL,
  computed_at INTEGER,
  PRIMARY KEY (wallet, category, window_days)
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                -- whale | fade | insider | consensus | arb | thin_move | drift | comment | early_resolution ...
  ts INTEGER NOT NULL,
  wallet TEXT, condition_id TEXT, outcome_index INTEGER,
  score REAL,
  payload TEXT,                      -- JSON
  outcome TEXT,                      -- filled when the market resolves: WIN | LOSS
  resolved_ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_signals_type_ts ON signals(type, ts DESC);

CREATE TABLE IF NOT EXISTS paper_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  ts INTEGER NOT NULL,
  wallet TEXT,                       -- leader wallet for copy strategies
  condition_id TEXT NOT NULL,
  outcome_index INTEGER NOT NULL,
  side TEXT NOT NULL,
  price REAL NOT NULL,
  size REAL NOT NULL,
  usd REAL NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'open',        -- open | closed | resolved | rejected
  close_price REAL, close_ts INTEGER, pnl REAL
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
`;

let _db: DatabaseSync | null = null;

export function openDb(file: string = DB_PATH): DatabaseSync {
    if (_db) return _db;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    _db = new DatabaseSync(file);
    _db.exec('PRAGMA busy_timeout = 15000');
    _db.exec(SCHEMA);
    return _db;
}

export function closeDb() { if (_db) { _db.close(); _db = null; } }

/** Prepared-statement cache. */
const stmts = new Map<string, StatementSync>();
export function stmt(sql: string): StatementSync {
    const db = openDb();
    let s = stmts.get(sql);
    if (!s) { s = db.prepare(sql); stmts.set(sql, s); }
    return s;
}

export function transaction<T>(fn: () => T): T {
    const db = openDb();
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function kvGet<T = unknown>(key: string): T | null {
    const r = stmt('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? JSON.parse(r.value) as T : null;
}
export function kvSet(key: string, value: unknown) {
    stmt('INSERT INTO kv(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, JSON.stringify(value), now());
}

export const now = () => Math.floor(Date.now() / 1000);
export const toTs = (iso: string | null | undefined): number | null => { if (!iso) return null; const t = Date.parse(iso); return Number.isFinite(t) ? Math.floor(t / 1000) : null; };

/** Simple row helpers used across modules. */
export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] { return stmt(sql).all(...(params as never[])) as T[]; }
export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined { return stmt(sql).get(...(params as never[])) as T | undefined; }
export function run(sql: string, ...params: unknown[]) { return stmt(sql).run(...(params as never[])); }

/** Reset statement cache (needed after closeDb in tests). */
export function _resetStmts() { stmts.clear(); }
