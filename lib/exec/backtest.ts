import { openDb, all, get, now } from '../pm/db';
import { ingestPrices } from '../pm/ingest';
import { walkBook, BookLevel } from '../pm/clob';
import { Snapshot, Strategy, StrategyOrder, PricePoint } from './strategies';
import type { ResolutionRiskFlags } from './risk';

/**
 * Unified backtester (spec §10). Replays hourly `prices` (YES token) per resolved market, calls the strategy at
 * every bar, fills at bar price ± slippage (partial fills from the nearest earlier book snapshot when one exists),
 * holds until take-profit / stop-loss / time stop / resolution. Fees are a parameter.
 */

export interface BacktestOptions {
    strategy: Strategy;
    days?: number;               // only markets whose end_ts is within the last N days (default 90)
    slippageBps?: number;        // default 50 (0.5 % of price)
    feeBps?: number;             // default 0 (Polymarket)
    maxUsd?: number;             // per-order cap (default 500)
    categories?: string[];       // filter
    maxMarkets?: number;         // default 400
    excludeSports?: boolean;     // default false
    log?: (m: string) => void;
}

export interface BtTrade { conditionId: string; question: string; category: string; outcomeIndex: 0 | 1; entryTs: number; entryPrice: number; usd: number; shares: number; exitTs: number; exitPrice: number; exitReason: string; pnl: number; reason: string }

export interface BacktestResult {
    strategy: string; params: Record<string, number>; markets: number; bars: number; trades: BtTrade[]; n: number; wins: number; winRate: number;
    staked: number; pnl: number; roi: number; maxDrawdown: number; equity: { ts: number; equity: number }[]; byCategory: Record<string, { n: number; pnl: number; staked: number }>
}

interface MarketRow { condition_id: string; question: string; category: string; clob_token_ids: string; liquidity: number; volume24hr: number; volume: number; start_ts: number | null; end_ts: number | null; winner_index: number; neg_risk: number; uma_status: string; description: string; resolution_source: string; is_sports: number }

/** Resolution-risk flags derived from market metadata (explicit, inspectable). */
export function flagsFor(m: { uma_status?: string; description?: string; resolution_source?: string; neg_risk?: number }): ResolutionRiskFlags {
    const d = (m.description || '').toLowerCase();
    return {
        umaDisputeHistory: /dispute/i.test(m.uma_status || ''),
        ambiguousRules: /(in the event of|ambiguous|sole discretion|may be resolved)/.test(d) && d.length < 400,
        thinResolutionSource: !(m.resolution_source || '').trim() && !/resolve/.test(d),
        multiOutcomeNegRisk: m.neg_risk === 1
    };
}

/** Make sure hourly price history exists for resolved markets (YES token). Returns markets filled.
 *  NOTE: CLOB `interval=max` returns only the trailing ~30 days; explicit startTs/endTs return nothing for closed markets.
 *  So every backtest covers at most the last month of each market's life. */
export async function ensurePrices(limit = 300, days = 90, log: (m: string) => void = () => {}): Promise<number> {
    openDb();
    const rows = all<{ condition_id: string; clob_token_ids: string }>(
        `SELECT condition_id, clob_token_ids FROM markets WHERE resolved = 1 AND clob_token_ids IS NOT NULL AND end_ts > ? ORDER BY end_ts DESC LIMIT ?`, now() - days * 86_400, limit * 3);
    let n = 0;
    for (const r of rows) {
        if (n >= limit) break;
        const tok = (JSON.parse(r.clob_token_ids || '[]') as string[])[0];
        if (!tok) continue;
        if (get('SELECT 1 FROM prices WHERE token_id = ? LIMIT 1', tok)) continue;
        try { const k = await ingestPrices(tok, 'max', 60); n++; if (k === 0) log(`no history for ${r.condition_id.slice(0, 10)}`); } catch (e) { log(`prices ${r.condition_id.slice(0, 10)}: ${(e as Error).message}`); }
    }
    log(`prices: filled ${n} markets`);
    return n;
}

function volumeBetween(cid: string, from: number, to: number): number {
    return get<{ v: number }>('SELECT COALESCE(SUM(usdc),0) v FROM trades WHERE condition_id = ? AND ts > ? AND ts <= ?', cid, from, to)?.v ?? 0;
}

function bookBefore(tokenId: string, ts: number): { bids: BookLevel[]; asks: BookLevel[] } | null {
    const r = get<{ bids: string; asks: string }>('SELECT bids, asks FROM book_snapshots WHERE token_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1', tokenId, ts);
    return r ? { bids: JSON.parse(r.bids || '[]'), asks: JSON.parse(r.asks || '[]') } : null;
}

/**
 * Fill model: price = bar price of the outcome × (1 + slippage). With a book snapshot, walk the asks (YES) — for NO
 * we approximate the NO ask as 1 − YES bid, so walk the bids inverted. Partial fill when the book is thinner than `usd`.
 */
export function fillOrder(o: StrategyOrder, barYes: number, slippageBps: number, maxUsd: number, book: { bids: BookLevel[]; asks: BookLevel[] } | null): { price: number; usd: number; shares: number } {
    const want = Math.min(o.usd, maxUsd);
    if (want <= 0) return { price: 0, usd: 0, shares: 0 };
    if (book) {
        const levels: BookLevel[] = o.outcomeIndex === 0 ? book.asks : book.bids.map(b => ({ price: 1 - b.price, size: b.size })).sort((a, b) => a.price - b.price);
        if (levels.length) {
            const w = walkBook(levels, 'BUY', want);
            if (w.filled > 0) return { price: w.avgPrice, usd: w.filled, shares: w.shares };
        }
    }
    const base = o.outcomeIndex === 0 ? barYes : 1 - barYes;
    const price = Math.min(0.999, base * (1 + slippageBps / 10_000));
    return { price, usd: want, shares: want / price };
}

export function maxDrawdown(equity: number[]): number {
    let peak = -Infinity, dd = 0;
    for (const e of equity) { peak = Math.max(peak, e); dd = Math.max(dd, peak - e); }
    return dd;
}

/** Run one strategy over a set of resolved markets loaded from the DB. */
export function runBacktest(o: BacktestOptions): BacktestResult {
    openDb();
    const log = o.log ?? (() => {});
    const days = o.days ?? 90, slippage = o.slippageBps ?? 50, feeBps = o.feeBps ?? 0, maxUsd = o.maxUsd ?? 500;
    let sql = `SELECT condition_id, question, category, clob_token_ids, liquidity, volume24hr, volume, start_ts, end_ts, winner_index, neg_risk, uma_status, description, resolution_source, is_sports
               FROM markets WHERE resolved = 1 AND winner_index IS NOT NULL AND end_ts > ?`;
    const params: unknown[] = [now() - days * 86_400];
    if (o.categories?.length) { sql += ` AND category IN (${o.categories.map(() => '?').join(',')})`; params.push(...o.categories); }
    if (o.excludeSports) sql += ' AND is_sports = 0';
    sql += ' ORDER BY end_ts DESC LIMIT ?'; params.push(o.maxMarkets ?? 400);
    const markets = all<MarketRow>(sql, ...params);
    return runBacktestOn(markets.map(m => ({ ...m, tokenId: (JSON.parse(m.clob_token_ids || '[]') as string[])[0] || '' })), o.strategy, { slippage, feeBps, maxUsd, log });
}

export interface BtMarketInput { condition_id: string; question: string; category: string; tokenId: string; liquidity: number; volume24hr: number; volume?: number; end_ts: number | null; winner_index: number; neg_risk: number; uma_status: string; description: string; resolution_source: string; history?: PricePoint[]; volumeFn?: (from: number, to: number) => number }

/** Core loop, DB-free when `history`/`volumeFn` are provided (used by tests with synthetic paths). */
export function runBacktestOn(markets: BtMarketInput[], strategy: Strategy, opt: { slippage: number; feeBps: number; maxUsd: number; log?: (m: string) => void }): BacktestResult {
    const trades: BtTrade[] = []; let bars = 0, used = 0, skippedFlat = 0;
    for (const m of markets) {
        const hist = m.history ?? all<PricePoint>('SELECT ts t, price p FROM prices WHERE token_id = ? ORDER BY ts ASC', m.tokenId);
        if (hist.length < 3) continue;
        // History that never moves is post-resolution flatline (CLOB keeps ~30 days of hourly points; markets that
        // resolved before that window have nothing decidable). Skip them rather than count 100 % "wins".
        const lo = Math.min(...hist.map(h => h.p)), hi = Math.max(...hist.map(h => h.p));
        if (hi - lo < 0.02) { skippedFlat++; continue; }
        used++;
        // Gamma zeroes `liquidity` once a market closes, so resolved markets need a proxy: lifetime volume.
        const liquidity = m.liquidity > 0 ? m.liquidity : m.volume24hr > 0 ? m.volume24hr : (m.volume ?? 0);
        const vol = m.volumeFn ?? ((a: number, b: number) => volumeBetween(m.condition_id, a, b));
        const flags = flagsFor(m);
        let open: (BtTrade & { order: StrategyOrder }) | null = null;
        for (let i = 0; i < hist.length; i++) {
            const bar = hist[i]; bars++;
            const yes = bar.p;
            // Exits for the open position
            if (open) {
                const px = open.outcomeIndex === 0 ? yes : 1 - yes;
                let why = '';
                if (open.order.takeProfit !== undefined && px >= open.order.takeProfit) why = 'take_profit';
                else if (open.order.stopLoss !== undefined && px <= open.order.stopLoss) why = 'stop_loss';
                else if (open.order.exitAfterSec !== undefined && bar.t - open.entryTs >= open.order.exitAfterSec) why = 'time_stop';
                if (why) { const exitPx = Math.max(0.001, px * (1 - opt.slippage / 10_000)); open.exitTs = bar.t; open.exitPrice = exitPx; open.exitReason = why; open.pnl = open.shares * exitPx - open.usd - (open.usd + open.shares * exitPx) * opt.feeBps / 10_000; trades.push(strip(open)); open = null; }
            }
            if (open) continue;
            const snap: Snapshot = {
                conditionId: m.condition_id, ts: bar.t, question: m.question, category: m.category, yesPrice: yes, endTs: m.end_ts, liquidity, volume24h: vol(bar.t - 86_400, bar.t) || m.volume24hr,
                volume1h: vol(bar.t - 3600, bar.t), history: hist.slice(0, i + 1), flags, negRisk: m.neg_risk === 1
            };
            const orders = strategy.decide(snap, false);
            if (!orders.length) continue;
            const ord = orders[0];
            const book = m.tokenId ? bookBefore(m.tokenId, bar.t) : null;
            const f = fillOrder(ord, yes, opt.slippage, opt.maxUsd, book);
            if (f.usd <= 0) continue;
            open = { conditionId: m.condition_id, question: m.question, category: m.category, outcomeIndex: ord.outcomeIndex, entryTs: bar.t, entryPrice: f.price, usd: f.usd, shares: f.shares, exitTs: 0, exitPrice: 0, exitReason: '', pnl: 0, reason: ord.reason, order: ord };
        }
        if (open) {
            const won = m.winner_index === open.outcomeIndex;
            open.exitTs = hist[hist.length - 1].t; open.exitPrice = won ? 1 : 0; open.exitReason = won ? 'resolved_win' : 'resolved_loss';
            open.pnl = (won ? open.shares : 0) - open.usd - open.usd * opt.feeBps / 10_000;
            trades.push(strip(open));
        }
    }
    trades.sort((a, b) => a.exitTs - b.exitTs);
    let eq = 0; const equity = trades.map(t => ({ ts: t.exitTs, equity: (eq += t.pnl) }));
    const staked = trades.reduce((s, t) => s + t.usd, 0), pnl = trades.reduce((s, t) => s + t.pnl, 0), wins = trades.filter(t => t.pnl > 0).length;
    const byCategory: BacktestResult['byCategory'] = {};
    for (const t of trades) { const c = byCategory[t.category] ?? { n: 0, pnl: 0, staked: 0 }; c.n++; c.pnl += t.pnl; c.staked += t.usd; byCategory[t.category] = c; }
    opt.log?.(`${strategy.name}: ${used} markets (${skippedFlat} flat/post-resolution skipped), ${bars} bars, ${trades.length} trades, pnl ${pnl.toFixed(0)} on ${staked.toFixed(0)} (${staked ? (100 * pnl / staked).toFixed(1) : '-'}%)`);
    return { strategy: strategy.name, params: strategy.params as Record<string, number>, markets: used, bars, trades, n: trades.length, wins, winRate: trades.length ? wins / trades.length : 0, staked, pnl, roi: staked ? pnl / staked : 0, maxDrawdown: maxDrawdown(equity.map(e => e.equity)), equity, byCategory };
}

function strip(t: BtTrade & { order: StrategyOrder }): BtTrade { const { order: _o, ...rest } = t; void _o; return rest; }
