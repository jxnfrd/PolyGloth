import { openDb, all, get } from '@/lib/pm/db';
import { dbStats } from '@/lib/pm/ingest';

/**
 * Read-only queries for the /intel pages. Everything here reads the local SQLite store
 * (data/polygloth.sqlite); nothing calls the network, so pages render in milliseconds.
 * Tables written by other modules (wallet_scores, signals, paper_orders) may be empty
 * until their CLIs have run; every query tolerates that.
 */

export type Row = Record<string, unknown>;

export function stats() { openDb(); return dbStats(); }

export function freshness() {
    openDb();
    return {
        lastTradeTs: get<{ t: number }>('SELECT MAX(ts) t FROM trades')?.t ?? null,
        lastIngestTs: get<{ t: number }>('SELECT MAX(trades_ingested_at) t FROM wallets')?.t ?? null,
        lastMarketUpdate: get<{ t: number }>('SELECT MAX(updated_at) t FROM markets')?.t ?? null,
        lastScoreTs: get<{ t: number }>('SELECT MAX(computed_at) t FROM wallet_scores')?.t ?? null,
        lastSignalTs: get<{ t: number }>('SELECT MAX(ts) t FROM signals')?.t ?? null
    };
}

export function signalCounts() {
    openDb();
    return all<{ type: string; n: number; wins: number; losses: number; last_ts: number }>(
        `SELECT type, COUNT(*) n, SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) wins, SUM(CASE WHEN outcome='LOSS' THEN 1 ELSE 0 END) losses, MAX(ts) last_ts FROM signals GROUP BY type ORDER BY n DESC`);
}

export function recentSignals(type?: string, limit = 100) {
    openDb();
    const rows = type
        ? all<Row>(`SELECT s.*, m.question, m.event_slug, m.category, m.yes_price FROM signals s LEFT JOIN markets m ON m.condition_id = s.condition_id WHERE s.type = ? ORDER BY s.ts DESC LIMIT ?`, type, limit)
        : all<Row>(`SELECT s.*, m.question, m.event_slug, m.category, m.yes_price FROM signals s LEFT JOIN markets m ON m.condition_id = s.condition_id ORDER BY s.ts DESC LIMIT ?`, limit);
    return rows.map(r => ({ ...r, payload: safeJson(r.payload) }) as Row);
}

export function topWallets(opts: { category?: string; windowDays?: number; minResolved?: number; limit?: number; order?: 'best' | 'worst' } = {}) {
    openDb();
    const { category = 'all', windowDays = 0, minResolved = 30, limit = 50, order = 'best' } = opts;
    return all<Row>(
        `SELECT s.*, w.username, w.lb_rank_pnl_month, w.lb_pnl_month, w.trade_count, w.first_trade_ts, w.last_trade_ts
           FROM wallet_scores s JOIN wallets w ON w.address = s.wallet
          WHERE s.category = ? AND s.window_days = ? AND s.n_resolved >= ?
          ORDER BY s.calibrated_roi ${order === 'best' ? 'DESC' : 'ASC'} LIMIT ?`, category, windowDays, minResolved, limit);
}

export function scoreCategories(): string[] {
    openDb();
    return all<{ category: string }>('SELECT DISTINCT category FROM wallet_scores ORDER BY category').map(r => r.category);
}

export function walletOverview(address: string) {
    openDb();
    const w = address.toLowerCase();
    const wallet = get<Row>('SELECT * FROM wallets WHERE address = ?', w);
    const scores = all<Row>('SELECT * FROM wallet_scores WHERE wallet = ? ORDER BY category, window_days', w);
    const trades = all<Row>(
        `SELECT t.*, m.question, m.category, m.resolved, m.winner_index, m.yes_price FROM trades t LEFT JOIN markets m ON m.condition_id = t.condition_id WHERE t.wallet = ? ORDER BY t.ts DESC LIMIT 200`, w);
    const byCategory = all<Row>(
        `SELECT COALESCE(m.category,'unknown') category, COUNT(*) n, SUM(t.usdc) usdc FROM trades t LEFT JOIN markets m ON m.condition_id = t.condition_id WHERE t.wallet = ? GROUP BY 1 ORDER BY usdc DESC`, w);
    const signals = all<Row>('SELECT * FROM signals WHERE wallet = ? ORDER BY ts DESC LIMIT 50', w).map(r => ({ ...r, payload: safeJson(r.payload) }) as Row);
    return { wallet, scores, trades, byCategory, signals };
}

export function markets(opts: { category?: string; q?: string; resolved?: 'open' | 'resolved' | 'all'; limit?: number; order?: 'volume24hr' | 'end_ts' | 'volume' } = {}) {
    openDb();
    const { category, q, resolved = 'open', limit = 200, order = 'volume24hr' } = opts;
    const where: string[] = []; const params: unknown[] = [];
    if (category && category !== 'all') { where.push('category = ?'); params.push(category); }
    if (q) { where.push('(question LIKE ? OR event_slug LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (resolved === 'open') where.push('resolved = 0 AND closed = 0');
    if (resolved === 'resolved') where.push('resolved = 1');
    const orderSql = order === 'end_ts' ? 'end_ts ASC' : order === 'volume' ? 'volume DESC' : 'volume24hr DESC';
    return all<Row>(`SELECT condition_id, event_slug, market_slug, question, category, yes_price, best_bid, best_ask, spread, volume, volume24hr, liquidity, end_ts, resolved, winner_index, neg_risk, is_sports, outcomes FROM markets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderSql} LIMIT ?`, ...params, limit);
}

export function marketCategories(): { category: string; n: number }[] {
    openDb();
    return all<{ category: string; n: number }>('SELECT category, COUNT(*) n FROM markets WHERE resolved = 0 GROUP BY category ORDER BY n DESC');
}

export function marketDetail(conditionId: string) {
    openDb();
    const cid = conditionId.toLowerCase();
    const market = get<Row>('SELECT * FROM markets WHERE condition_id = ?', cid);
    if (!market) return null;
    const event = market.event_slug ? get<Row>('SELECT * FROM events WHERE slug = ?', market.event_slug as string) : undefined;
    const siblings = market.event_slug ? all<Row>('SELECT condition_id, question, yes_price, best_bid, best_ask, volume24hr, resolved, winner_index FROM markets WHERE event_slug = ? ORDER BY yes_price DESC', market.event_slug as string) : [];
    const trades = all<Row>(`SELECT t.*, w.username FROM trades t LEFT JOIN wallets w ON w.address = t.wallet WHERE t.condition_id = ? ORDER BY t.ts DESC LIMIT 300`, cid);
    const flow = all<Row>(
        `SELECT outcome_index, side, COUNT(*) n, SUM(usdc) usdc FROM trades WHERE condition_id = ? AND ts > ? GROUP BY outcome_index, side`, cid, Math.floor(Date.now() / 1000) - 24 * 3600);
    const holders = all<Row>(
        `SELECT t.wallet, w.username, t.outcome_index, SUM(CASE WHEN side='BUY' THEN size ELSE -size END) net_shares, SUM(CASE WHEN side='BUY' THEN usdc ELSE -usdc END) net_usdc,
                s.calibrated_roi, s.n_resolved, s.p_value
           FROM trades t LEFT JOIN wallets w ON w.address = t.wallet LEFT JOIN wallet_scores s ON s.wallet = t.wallet AND s.category = 'all' AND s.window_days = 0
          WHERE t.condition_id = ? GROUP BY t.wallet, t.outcome_index HAVING net_shares > 1 ORDER BY net_usdc DESC LIMIT 40`, cid);
    const comments = event ? all<Row>('SELECT * FROM comments WHERE event_id = ? ORDER BY created_ts DESC LIMIT 50', event.id as string) : [];
    const signals = all<Row>('SELECT * FROM signals WHERE condition_id = ? ORDER BY ts DESC LIMIT 50', cid).map(r => ({ ...r, payload: safeJson(r.payload) }) as Row);
    const book = get<Row>('SELECT * FROM book_snapshots WHERE token_id IN (SELECT value FROM json_each(?)) ORDER BY ts DESC LIMIT 1', market.clob_token_ids as string);
    const prices = all<{ ts: number; price: number }>('SELECT ts, price FROM prices WHERE token_id = ? ORDER BY ts', safeJson<string[]>(market.clob_token_ids)?.[0] ?? '');
    return { market: { ...market, outcomes: safeJson(market.outcomes), clob_token_ids: safeJson(market.clob_token_ids) } as Row, event, siblings, trades, flow, holders, comments, signals, book, prices };
}

export function paperReport() {
    openDb();
    const byStrategy = all<Row>(
        `SELECT strategy, COUNT(*) n, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) open, SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected,
                SUM(CASE WHEN status IN ('closed','resolved') THEN 1 ELSE 0 END) done, SUM(COALESCE(pnl,0)) pnl, SUM(usd) usd,
                SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) wins FROM paper_orders GROUP BY strategy ORDER BY n DESC`);
    const recent = all<Row>(`SELECT p.*, m.question FROM paper_orders p LEFT JOIN markets m ON m.condition_id = p.condition_id ORDER BY p.ts DESC LIMIT 100`);
    return { byStrategy, recent };
}

export function whalePositionsLatest(limit = 100) {
    openDb();
    return all<Row>(
        `SELECT ps.*, w.username, w.lb_rank_pnl_month, m.question, m.event_slug, m.category, m.outcomes
           FROM position_snapshots ps JOIN (SELECT wallet, MAX(ts) ts FROM position_snapshots GROUP BY wallet) l ON l.wallet = ps.wallet AND l.ts = ps.ts
           LEFT JOIN wallets w ON w.address = ps.wallet LEFT JOIN markets m ON m.condition_id = ps.condition_id
          WHERE ps.cur_price > 0.01 AND ps.cur_price < 0.99 ORDER BY ps.current_value DESC LIMIT ?`, limit).map(r => ({ ...r, outcomes: safeJson(r.outcomes) }) as Row);
}

export function kalshiMarkets(q?: string, limit = 200) {
    openDb();
    return q ? all<Row>('SELECT * FROM kalshi_markets WHERE title LIKE ? ORDER BY volume24h DESC LIMIT ?', `%${q}%`, limit)
             : all<Row>('SELECT * FROM kalshi_markets ORDER BY volume24h DESC LIMIT ?', limit);
}

export function safeJson<T = unknown>(v: unknown): T | null {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') return v as T;
    try { return JSON.parse(v) as T; } catch { return null; }
}
