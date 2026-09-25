import { openDb, all, now } from '../pm/db';
import { stats, freshness, signalCounts, recentSignals, topWallets, walletOverview, markets, marketDetail, safeJson, Row } from '../ui/queries';
import { ALL_CATEGORIES } from '../pm/categories';

/**
 * Tool functions shared by the JSON API (app/api/intel/*) and the MCP server (scripts/pm-mcp.ts).
 * Pure reads of the local SQLite store, except `arbOpportunities({ live: true })`, which calls the
 * live arb scanners in lib/market/arb.ts (network + writes signals) when explicitly asked.
 */

export interface ToolDef {
    name: string;
    description: string;
    inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

const CATEGORY_ENUM = ['all', ...ALL_CATEGORIES];

export const TOOL_DEFS: ToolDef[] = [
    { name: 'db_stats', description: 'Row counts and freshness of the local PolyGloth store (wallets, trades, markets, signals, last ingest).', inputSchema: { type: 'object', properties: {} } },
    { name: 'top_wallets', description: 'Sharpest (order=best) or most fadeable (order=worst) Polymarket wallets by calibrated ROI, per category and window. Requires wallet_scores to be populated (scripts/pm-score.ts).', inputSchema: { type: 'object', properties: { category: { type: 'string', enum: CATEGORY_ENUM, default: 'all' }, windowDays: { type: 'integer', enum: [0, 30, 90], default: 0, description: '0 = all time' }, minResolved: { type: 'integer', default: 30 }, order: { type: 'string', enum: ['best', 'worst'], default: 'best' }, limit: { type: 'integer', default: 20, maximum: 100 } } } },
    { name: 'wallet_report', description: 'Everything stored about one wallet (proxy address 0x…): leaderboard rank, scores per category/window, notional by category, signals, last 200 trades with WIN/LOSS where resolved.', inputSchema: { type: 'object', properties: { address: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' }, trades: { type: 'integer', default: 30, maximum: 200, description: 'how many recent trades to include' } }, required: ['address'] } },
    { name: 'search_markets', description: 'Search Polymarket markets in the local store by text, category and state.', inputSchema: { type: 'object', properties: { q: { type: 'string' }, category: { type: 'string', enum: CATEGORY_ENUM, default: 'all' }, state: { type: 'string', enum: ['open', 'resolved', 'all'], default: 'open' }, order: { type: 'string', enum: ['volume24hr', 'volume', 'end_ts'], default: 'volume24hr' }, limit: { type: 'integer', default: 20, maximum: 200 } } } },
    { name: 'market_detail', description: 'One market by conditionId: price, book depth, 24h taker flow, sibling markets in the same event, largest ingested holders with scores, signals, stored comments, resolution rules.', inputSchema: { type: 'object', properties: { conditionId: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' }, trades: { type: 'integer', default: 20, maximum: 300 }, comments: { type: 'integer', default: 10, maximum: 50 } }, required: ['conditionId'] } },
    { name: 'recent_signals', description: 'Latest signals (consensus, divergence, fade, insider, arb_*, thin_move, comment_spike, early_resolution, …) with market context and WIN/LOSS once resolved.', inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'signal type; omit for all' }, since: { type: 'integer', description: 'unix seconds; omit for no lower bound' }, limit: { type: 'integer', default: 50, maximum: 300 } } } },
    { name: 'arb_opportunities', description: 'Arbitrage candidates: multi-outcome sums, ladder/logical violations, cross-venue (Polymarket vs Kalshi). Stored signals by default; live=true re-scans (network, slower).', inputSchema: { type: 'object', properties: { live: { type: 'boolean', default: false }, minEdge: { type: 'number', default: 0.005, description: 'fraction of payout, 0.01 = 1%' }, limit: { type: 'integer', default: 20, maximum: 200 } } } },
    { name: 'whales_in_category_today', description: 'Which scored wallets (calibrated ROI > 0, p < 0.1) traded a category in the last N hours, with side and notional. Answers "which top wallets entered Fed markets today?" (category=economy).', inputSchema: { type: 'object', properties: { category: { type: 'string', enum: CATEGORY_ENUM, default: 'economy' }, hours: { type: 'integer', default: 24, maximum: 720 }, minResolved: { type: 'integer', default: 30 }, maxPValue: { type: 'number', default: 0.1 }, minUsdc: { type: 'number', default: 100 }, limit: { type: 'integer', default: 50, maximum: 300 } } } }
];

const int = (v: unknown, d: number, max = Number.MAX_SAFE_INTEGER) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : d; };
const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

export function dbStatsTool() {
    openDb();
    return { stats: stats(), freshness: freshness(), signals: signalCounts() };
}

export function topWalletsTool(a: Record<string, unknown> = {}) {
    return topWallets({ category: str(a.category, 'all'), windowDays: int(a.windowDays, 0), minResolved: int(a.minResolved, 30), order: a.order === 'worst' ? 'worst' : 'best', limit: int(a.limit, 20, 100) });
}

export function walletReportTool(a: Record<string, unknown>) {
    const address = str(a.address).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error('address must be a 0x… proxy wallet (40 hex chars)');
    const r = walletOverview(address);
    return { ...r, trades: r.trades.slice(0, int(a.trades, 30, 200)) };
}

export function searchMarketsTool(a: Record<string, unknown> = {}) {
    const state = (['open', 'resolved', 'all'] as const).find(s => s === a.state) ?? 'open';
    const order = (['volume24hr', 'volume', 'end_ts'] as const).find(s => s === a.order) ?? 'volume24hr';
    return markets({ q: str(a.q), category: str(a.category, 'all'), resolved: state, order, limit: int(a.limit, 20, 200) });
}

export function marketDetailTool(a: Record<string, unknown>) {
    const cid = str(a.conditionId).toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(cid)) throw new Error('conditionId must be 0x… (64 hex chars)');
    const d = marketDetail(cid);
    if (!d) return null;
    return { ...d, trades: d.trades.slice(0, int(a.trades, 20, 300)), comments: d.comments.slice(0, int(a.comments, 10, 50)), prices: d.prices.slice(-100) };
}

export function recentSignalsTool(a: Record<string, unknown> = {}) {
    const rows = recentSignals(str(a.type) || undefined, int(a.limit, 50, 300));
    const since = a.since === undefined ? 0 : int(a.since, 0);
    return since ? rows.filter(r => Number(r.ts) >= since) : rows;
}

export interface ArbSummary { type: string; n: number; latestTs: number | null; items: Row[] }

export async function arbOpportunitiesTool(a: Record<string, unknown> = {}): Promise<{ live: boolean; minEdge: number; groups: ArbSummary[]; liveScan?: Record<string, unknown> }> {
    openDb();
    const minEdge = num(a.minEdge, 0.005); const limit = int(a.limit, 20, 200); const live = a.live === true || a.live === 'true' || a.live === 1 || a.live === '1';
    let liveScan: Record<string, unknown> | undefined;
    if (live) {
        // Explicit opt-in: these hit Gamma/CLOB/Kalshi and append to `signals`.
        const arb = await import('../market/arb');
        const [multi, ladders, logical, cross] = await Promise.all([
            arb.scanMultiOutcome({ live: true, minEdge, limit }),
            Promise.resolve(arb.scanLadders(Math.max(0.01, minEdge))),
            Promise.resolve(arb.scanLogical(Math.max(0.01, minEdge))),
            Promise.resolve(arb.scanCrossVenue(minEdge))
        ]);
        liveScan = { multiOutcome: multi.slice(0, limit), ladders: ladders.slice(0, limit), logical: logical.slice(0, limit), crossVenue: cross.slice(0, limit) };
    }
    const types = ['arb_multi_outcome', 'arb_ladder', 'arb_logical', 'arb_cross_venue'];
    const groups: ArbSummary[] = types.map(type => {
        const rows = all<Row>(`SELECT s.*, m.question, m.event_slug, m.category, m.yes_price FROM signals s LEFT JOIN markets m ON m.condition_id = s.condition_id WHERE s.type = ? ORDER BY s.ts DESC LIMIT ?`, type, limit)
            .map(r => ({ ...r, payload: safeJson(r.payload) }) as Row)
            .filter(r => { const p = r.payload as Record<string, unknown> | null; const edge = Number(p?.edge ?? p?.spread ?? 0); return !Number.isFinite(edge) || edge === 0 || edge >= minEdge; });
        return { type, n: rows.length, latestTs: rows.length ? Number(rows[0].ts) : null, items: rows };
    });
    return { live, minEdge, groups, ...(liveScan ? { liveScan } : {}) };
}

export interface WhaleEntry { wallet: string; username: string | null; category: string; calibrated_roi: number; p_value: number; n_resolved: number; buys_usdc: number; sells_usdc: number; markets: { condition_id: string; question: string; side: string; outcome: string; usdc: number; price: number; ts: number }[] }

export function whalesInCategoryTodayTool(a: Record<string, unknown> = {}): WhaleEntry[] {
    openDb();
    const category = str(a.category, 'economy'); const hours = int(a.hours, 24, 720); const minResolved = int(a.minResolved, 30); const maxP = num(a.maxPValue, 0.1); const minUsdc = num(a.minUsdc, 100); const limit = int(a.limit, 50, 300);
    const since = now() - hours * 3600;
    const catFilter = category === 'all' ? '' : 'AND m.category = ?';
    const params: unknown[] = [since, minUsdc];
    if (category !== 'all') params.push(category);
    params.push(minResolved, maxP);
    const rows = all<{ wallet: string; username: string | null; category: string; calibrated_roi: number; p_value: number; n_resolved: number; condition_id: string; question: string; side: string; outcome: string; usdc: number; price: number; ts: number }>(
        `SELECT t.wallet, w.username, m.category, s.calibrated_roi, s.p_value, s.n_resolved, t.condition_id, m.question, t.side, t.outcome, t.usdc, t.price, t.ts
           FROM trades t
           JOIN markets m ON m.condition_id = t.condition_id
           JOIN wallet_scores s ON s.wallet = t.wallet AND s.category = 'all' AND s.window_days = 0
           LEFT JOIN wallets w ON w.address = t.wallet
          WHERE t.ts >= ? AND t.usdc >= ? ${catFilter}
            AND s.n_resolved >= ? AND s.calibrated_roi > 0 AND s.p_value < ?
          ORDER BY t.ts DESC LIMIT 5000`, ...params);
    const byWallet = new Map<string, WhaleEntry>();
    for (const r of rows) {
        let e = byWallet.get(r.wallet);
        if (!e) { e = { wallet: r.wallet, username: r.username, category, calibrated_roi: r.calibrated_roi, p_value: r.p_value, n_resolved: r.n_resolved, buys_usdc: 0, sells_usdc: 0, markets: [] }; byWallet.set(r.wallet, e); }
        if (r.side === 'BUY') e.buys_usdc += r.usdc; else e.sells_usdc += r.usdc;
        if (e.markets.length < 25) e.markets.push({ condition_id: r.condition_id, question: r.question, side: r.side, outcome: r.outcome, usdc: Math.round(r.usdc), price: r.price, ts: r.ts });
    }
    return Array.from(byWallet.values()).sort((x, y) => (y.buys_usdc + y.sells_usdc) - (x.buys_usdc + x.sells_usdc)).slice(0, limit);
}

/** Dispatch by tool name. Throws on unknown tool or bad input. */
export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
        case 'db_stats': return dbStatsTool();
        case 'top_wallets': return topWalletsTool(args);
        case 'wallet_report': return walletReportTool(args);
        case 'search_markets': return searchMarketsTool(args);
        case 'market_detail': return marketDetailTool(args);
        case 'recent_signals': return recentSignalsTool(args);
        case 'arb_opportunities': return arbOpportunitiesTool(args);
        case 'whales_in_category_today': return whalesInCategoryTodayTool(args);
        default: throw new Error(`unknown tool: ${name}`);
    }
}
