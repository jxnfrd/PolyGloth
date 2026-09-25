/**
 * Order book, flow and microstructure analytics (spec §7).
 *
 * Taker-side assumption: Data API trade rows carry `side` (BUY/SELL) for the token named by `outcome`/`outcomeIndex`
 * from the perspective of the wallet on the row, and the row is the taker fill. BUY of outcome 1 (NO) is economically
 * a SELL of YES. All YES-equivalent notional below is computed as: BUY idx0 → +usdc, SELL idx0 → −usdc, BUY idx1 → −usdc, SELL idx1 → +usdc.
 * For multi-outcome (neg-risk) markets each outcome token is its own binary market, so per-outcome imbalance is reported.
 */
import { openDb, all, get, run, now, transaction } from '../pm/db';
import { orderBook, walkBook, depthWithin, OrderBook, BookLevel } from '../pm/clob';
import { snapshotBook } from '../pm/ingest';
import { disputeRisk } from './resolution';

export function ensureSchema() { openDb(); }

interface TradeRow { wallet: string; outcome_index: number; side: string; size: number; price: number; usdc: number; ts: number }

export function marketTradesRows(conditionId: string, sinceTs = 0): TradeRow[] {
    return all<TradeRow>('SELECT wallet, outcome_index, side, size, price, usdc, ts FROM trades WHERE condition_id = ? AND ts >= ? ORDER BY ts ASC', conditionId, sinceTs);
}

// ---------------------------------------------------------------------------
// Aggressor imbalance
// ---------------------------------------------------------------------------
export interface Imbalance { windowMin: number; outcomeIndex: number; buyUsd: number; sellUsd: number; imbalance: number; n: number }

/** imbalance = (buy − sell) / (buy + sell) per outcome token, per window. */
export function aggressorImbalance(trades: TradeRow[], at = now(), windowsMin = [5, 60, 240]): Imbalance[] {
    const out: Imbalance[] = [];
    for (const w of windowsMin) {
        const from = at - w * 60;
        const byOutcome = new Map<number, { b: number; s: number; n: number }>();
        for (const t of trades) {
            if (t.ts < from || t.ts > at) continue;
            const c = byOutcome.get(t.outcome_index) ?? { b: 0, s: 0, n: 0 };
            if (t.side === 'BUY') c.b += t.usdc; else c.s += t.usdc; c.n++;
            byOutcome.set(t.outcome_index, c);
        }
        Array.from(byOutcome.entries()).sort((a, b) => a[0] - b[0]).forEach(([oi, c]) => out.push({ windowMin: w, outcomeIndex: oi, buyUsd: c.b, sellUsd: c.s, imbalance: c.b + c.s > 0 ? (c.b - c.s) / (c.b + c.s) : 0, n: c.n }));
    }
    return out;
}

/** YES-equivalent net aggression (see header assumption) over a window. */
export function yesNetFlow(trades: TradeRow[], at = now(), windowMin = 60): number {
    let net = 0;
    for (const t of trades) {
        if (t.ts < at - windowMin * 60 || t.ts > at) continue;
        const sign = (t.outcome_index === 0 ? 1 : -1) * (t.side === 'BUY' ? 1 : -1);
        net += sign * t.usdc;
    }
    return net;
}

// ---------------------------------------------------------------------------
// Large-fill clustering (icebergs)
// ---------------------------------------------------------------------------
export interface FillCluster { outcomeIndex: number; side: string; wallet: string; n: number; totalUsd: number; avgSize: number; firstTs: number; lastTs: number }

export function largeFillClusters(trades: TradeRow[], minFills = 3, sizeTolerance = 0.10, windowSec = 120): FillCluster[] {
    const sorted = [...trades].sort((a, b) => a.ts - b.ts);
    const used = new Set<number>(); const out: FillCluster[] = [];
    for (let i = 0; i < sorted.length; i++) {
        if (used.has(i)) continue;
        const a = sorted[i]; const members = [i];
        for (let j = i + 1; j < sorted.length && sorted[j].ts - sorted[members[members.length - 1]].ts <= windowSec; j++) {
            const b = sorted[j];
            if (used.has(j) || b.side !== a.side || b.outcome_index !== a.outcome_index || b.wallet !== a.wallet) continue;
            if (Math.abs(b.size - a.size) / Math.max(a.size, 1e-9) <= sizeTolerance) members.push(j);
        }
        if (members.length >= minFills) {
            members.forEach(m => used.add(m));
            const ms = members.map(m => sorted[m]);
            out.push({ outcomeIndex: a.outcome_index, side: a.side, wallet: a.wallet, n: ms.length, totalUsd: ms.reduce((s, t) => s + t.usdc, 0), avgSize: ms.reduce((s, t) => s + t.size, 0) / ms.length, firstTs: ms[0].ts, lastTs: ms[ms.length - 1].ts });
        }
    }
    return out.sort((a, b) => b.totalUsd - a.totalUsd);
}

// ---------------------------------------------------------------------------
// Depth / slippage map
// ---------------------------------------------------------------------------
export interface DepthMap {
    tokenId: string; bestBid: number | null; bestAsk: number | null; spread: number | null;
    buy: { within1c: number; within3c: number; within5c: number; maxUsdAt1cImpact: number };
    sell: { within1c: number; within3c: number; within5c: number; maxUsdAt1cImpact: number };
    fill: { usd: number; buyAvg: number; buyWorst: number; sellAvg: number; sellWorst: number }[];
}

/** maxUsdAt1cImpact = USD fillable such that the average fill price stays within 1¢ of the best level. */
function maxUsdWithinImpact(levels: BookLevel[], side: 'BUY' | 'SELL', cents: number): number {
    if (!levels.length) return 0;
    const best = levels[0].price;
    let lo = 0, hi = levels.reduce((s, l) => s + l.price * l.size, 0);
    for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const w = walkBook(levels, side, mid);
        const ok = w.filled >= mid - 1e-6 && Math.abs(w.avgPrice - best) <= cents / 100 + 1e-9;
        if (ok) lo = mid; else hi = mid;
    }
    return lo;
}

export function depthMap(book: OrderBook, sizes = [100, 1000, 5000, 25000]): DepthMap {
    const fill = sizes.map(usd => { const b = walkBook(book.asks, 'BUY', usd), s = walkBook(book.bids, 'SELL', usd); return { usd, buyAvg: b.avgPrice, buyWorst: b.worstPrice, sellAvg: s.avgPrice, sellWorst: s.worstPrice }; });
    return {
        tokenId: book.tokenId, bestBid: book.bestBid, bestAsk: book.bestAsk, spread: book.spread,
        buy: { within1c: depthWithin(book.asks, 'BUY', 1), within3c: depthWithin(book.asks, 'BUY', 3), within5c: depthWithin(book.asks, 'BUY', 5), maxUsdAt1cImpact: maxUsdWithinImpact(book.asks, 'BUY', 1) },
        sell: { within1c: depthWithin(book.bids, 'SELL', 1), within3c: depthWithin(book.bids, 'SELL', 3), within5c: depthWithin(book.bids, 'SELL', 5), maxUsdAt1cImpact: maxUsdWithinImpact(book.bids, 'SELL', 1) },
        fill
    };
}

export async function liveDepthMap(tokenId: string): Promise<DepthMap> { return depthMap(await orderBook(tokenId)); }

// ---------------------------------------------------------------------------
// Spoof detector: large levels that vanished between two snapshots without trades
// ---------------------------------------------------------------------------
export interface SpoofSuspect { side: 'bid' | 'ask'; price: number; size: number; usd: number; medianLevelSize: number }

function median(xs: number[]): number { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

export function spoofSuspects(before: { bids: BookLevel[]; asks: BookLevel[] }, after: { bids: BookLevel[]; asks: BookLevel[] }, tradesBetween: TradeRow[], multiple = 5): SpoofSuspect[] {
    const out: SpoofSuspect[] = [];
    const tradedUsd = tradesBetween.reduce((s, t) => s + t.usdc, 0);
    for (const side of ['bids', 'asks'] as const) {
        const med = median(before[side].map(l => l.size));
        const afterMap = new Map(after[side].map(l => [l.price, l.size] as [number, number]));
        for (const l of before[side]) {
            if (med > 0 && l.size >= multiple * med) {
                const remaining = afterMap.get(l.price) ?? 0;
                const vanished = l.size - remaining;
                // vanished size not explained by trades between snapshots
                if (vanished >= 0.8 * l.size && vanished * l.price > tradedUsd * 1.05) out.push({ side: side === 'bids' ? 'bid' : 'ask', price: l.price, size: l.size, usd: l.size * l.price, medianLevelSize: med });
            }
        }
    }
    return out;
}

/** Take two snapshots `gapSec` apart and run the spoof detector; writes 'spoof_suspect' signals. */
export async function detectSpoofing(conditionId: string, tokenId: string, gapSec = 45): Promise<SpoofSuspect[]> {
    const b1 = await orderBook(tokenId);
    await new Promise(r => setTimeout(r, gapSec * 1000));
    const b2 = await orderBook(tokenId);
    const between = marketTradesRows(conditionId, b1.fetchedAt).filter(t => t.ts <= b2.fetchedAt);
    const s = spoofSuspects(b1, b2, between);
    transaction(() => { for (const x of s) run('INSERT INTO signals(type, ts, condition_id, score, payload) VALUES (?,?,?,?,?)', 'spoof_suspect', now(), conditionId, Math.min(100, Math.round(x.size / x.medianLevelSize) * 5), JSON.stringify({ tokenId, ...x })); });
    return s;
}

// ---------------------------------------------------------------------------
// Thin-move reversion
// ---------------------------------------------------------------------------
export interface ThinMove { conditionId: string; from: number; to: number; moveCents: number; notionalUsd: number; volume24hr: number; share: number; fadeSide: 'YES' | 'NO' }

/**
 * Price change ≥ minMoveCents within `windowMin` on notional < thinShare × volume24hr.
 * Price path = `prices` rows for the YES token if present, else the trade prints (idx0 price, idx1 → 1−price).
 */
export function thinMove(conditionId: string, opts: { windowMin?: number; minMoveCents?: number; thinShare?: number; at?: number } = {}): ThinMove | null {
    const windowMin = opts.windowMin ?? 60, minMove = opts.minMoveCents ?? 8, thinShare = opts.thinShare ?? 0.02, at = opts.at ?? now();
    const m = get<{ clob_token_ids: string; volume24hr: number | null }>('SELECT clob_token_ids, volume24hr FROM markets WHERE condition_id = ?', conditionId);
    if (!m) return null;
    const yesTok = (JSON.parse(m.clob_token_ids || '[]') as string[])[0];
    let path: { ts: number; p: number }[] = yesTok ? all<{ ts: number; p: number }>('SELECT ts, price p FROM prices WHERE token_id = ? AND ts >= ? AND ts <= ? ORDER BY ts', yesTok, at - windowMin * 60, at) : [];
    const trades = marketTradesRows(conditionId, at - windowMin * 60).filter(t => t.ts <= at);
    if (path.length < 2) path = trades.map(t => ({ ts: t.ts, p: t.outcome_index === 0 ? t.price : 1 - t.price }));
    if (path.length < 2) return null;
    const from = path[0].p, to = path[path.length - 1].p;
    const move = (to - from) * 100;
    const notional = trades.reduce((s, t) => s + t.usdc, 0);
    const vol24 = m.volume24hr ?? 0;
    if (Math.abs(move) < minMove || vol24 <= 0 || notional >= thinShare * vol24) return null;
    return { conditionId, from, to, moveCents: Math.round(move * 10) / 10, notionalUsd: notional, volume24hr: vol24, share: notional / vol24, fadeSide: move > 0 ? 'NO' : 'YES' };
}

export function scanThinMoves(limit = 100): ThinMove[] {
    const rows = all<{ condition_id: string }>('SELECT DISTINCT condition_id FROM trades WHERE ts > ? LIMIT ?', now() - 3600, limit);
    const out: ThinMove[] = [];
    for (const r of rows) { const tm = thinMove(r.condition_id); if (tm) out.push(tm); }
    transaction(() => { for (const x of out) run('INSERT INTO signals(type, ts, condition_id, outcome_index, score, payload) VALUES (?,?,?,?,?,?)', 'thin_move', now(), x.conditionId, x.fadeSide === 'YES' ? 0 : 1, Math.min(100, Math.abs(x.moveCents) * 5), JSON.stringify(x)); });
    return out;
}

// ---------------------------------------------------------------------------
// Open-interest proxy (event-level only: Polymarket exposes OI per event, not per market)
// ---------------------------------------------------------------------------
export function oiDivergence(conditionId: string): { priceChange1h: number | null; eventOi: number | null; note: string } {
    const m = get<{ event_id: string; yes_price: number | null; clob_token_ids: string }>('SELECT event_id, yes_price, clob_token_ids FROM markets WHERE condition_id = ?', conditionId);
    if (!m) return { priceChange1h: null, eventOi: null, note: 'unknown market' };
    const ev = get<{ open_interest: number | null }>('SELECT open_interest FROM events WHERE id = ?', m.event_id);
    const tok = (JSON.parse(m.clob_token_ids || '[]') as string[])[0];
    const p1 = tok ? get<{ price: number }>('SELECT price FROM prices WHERE token_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1', tok, now() - 3600) : undefined;
    const chg = p1 && m.yes_price !== null ? m.yes_price - p1.price : null;
    return { priceChange1h: chg, eventOi: ev?.open_interest ?? null, note: 'OI is per event (events.open_interest); per-market OI is not exposed by the public API. Track deltas across refreshes for rising-price/falling-OI flags.' };
}

// ---------------------------------------------------------------------------
// Time-of-day liquidity profile (needs book_snapshots; snapshotTopMarkets collects them)
// ---------------------------------------------------------------------------
export async function snapshotTopMarkets(n = 20): Promise<number> {
    const rows = all<{ clob_token_ids: string }>('SELECT clob_token_ids FROM markets WHERE closed = 0 AND is_sports = 0 ORDER BY volume24hr DESC LIMIT ?', n);
    let k = 0;
    for (const r of rows) { const tok = (JSON.parse(r.clob_token_ids || '[]') as string[])[0]; if (tok) { try { await snapshotBook(tok); k++; } catch { /* skip */ } } }
    return k;
}

export function timeOfDayProfile(tokenId?: string): { hourUtc: number; n: number; meanSpread: number; meanDepth1c: number }[] {
    const rows = all<{ h: number; n: number; sp: number; d: number }>(`SELECT ((ts % 86400) / 3600) h, COUNT(*) n, AVG(spread) sp, AVG(depth_bid_1c + depth_ask_1c) d FROM book_snapshots ${tokenId ? 'WHERE token_id = ?' : ''} GROUP BY h ORDER BY h`, ...(tokenId ? [tokenId] : []));
    return rows.map(r => ({ hourUtc: r.h, n: r.n, meanSpread: r.sp, meanDepth1c: r.d }));
}

// ---------------------------------------------------------------------------
// Market-maker footprint
// ---------------------------------------------------------------------------
export interface MakerFootprint { wallet: string; buyShare: number; sellShare: number; netShares: number; grossShares: number; lastTs: number; medianGapSec: number; quotingStopped: boolean }

export function marketMakerFootprint(conditionId: string, minShare = 0.4): MakerFootprint[] {
    const trades = marketTradesRows(conditionId);
    const totB = trades.filter(t => t.side === 'BUY').reduce((s, t) => s + t.usdc, 0), totS = trades.filter(t => t.side === 'SELL').reduce((s, t) => s + t.usdc, 0);
    const byW = new Map<string, TradeRow[]>();
    for (const t of trades) { const a = byW.get(t.wallet) ?? []; a.push(t); byW.set(t.wallet, a); }
    const out: MakerFootprint[] = [];
    Array.from(byW.entries()).forEach(([w, ts]) => {
        const b = ts.filter(t => t.side === 'BUY').reduce((s, t) => s + t.usdc, 0), s = ts.filter(t => t.side === 'SELL').reduce((x, t) => x + t.usdc, 0);
        const buyShare = totB ? b / totB : 0, sellShare = totS ? s / totS : 0;
        if (buyShare < minShare || sellShare < minShare) return;
        const net = ts.reduce((x, t) => x + (t.side === 'BUY' ? t.size : -t.size) * (t.outcome_index === 0 ? 1 : -1), 0);
        const gross = ts.reduce((x, t) => x + t.size, 0);
        if (gross && Math.abs(net) / gross > 0.3) return; // directional, not a maker
        const sorted = ts.map(t => t.ts).sort((a, c) => a - c);
        const gaps = sorted.slice(1).map((t, i) => t - sorted[i]);
        const medGap = median(gaps);
        out.push({ wallet: w, buyShare, sellShare, netShares: net, grossShares: gross, lastTs: sorted[sorted.length - 1], medianGapSec: medGap, quotingStopped: medGap > 0 && now() - sorted[sorted.length - 1] > 2 * medGap });
    });
    return out.sort((a, b) => (b.buyShare + b.sellShare) - (a.buyShare + a.sellShare));
}

// ---------------------------------------------------------------------------
// Resolution drift ("last cents" yield)
// ---------------------------------------------------------------------------
export interface DriftCandidate { condition_id: string; question: string; side: 'YES' | 'NO'; price: number; daysToEnd: number; grossYield: number; annualized: number; disputeRisk: number; reasons: string[] }

export function resolutionDrift(opts: { minPrice?: number; maxDays?: number; limit?: number } = {}): DriftCandidate[] {
    const minP = opts.minPrice ?? 0.93, maxDays = opts.maxDays ?? 14, t = now();
    const rows = all<{ condition_id: string; question: string; description: string; resolution_source: string; yes_price: number; best_ask: number | null; end_ts: number; is_sports: number }>(
        `SELECT condition_id, question, description, resolution_source, yes_price, best_ask, end_ts, is_sports FROM markets WHERE closed = 0 AND resolved = 0 AND end_ts IS NOT NULL AND end_ts > ? AND end_ts <= ? AND yes_price IS NOT NULL AND (yes_price >= ? OR yes_price <= ?) ORDER BY volume24hr DESC LIMIT 400`,
        t, t + maxDays * 86400, minP, 1 - minP);
    const out: DriftCandidate[] = [];
    for (const r of rows) {
        const side: 'YES' | 'NO' = r.yes_price >= 0.5 ? 'YES' : 'NO';
        // ask for the likely side: YES ask = best_ask; NO ask ≈ 1 − best_bid, approximated by 1 − yes_price when bids unknown
        const price = side === 'YES' ? (r.best_ask ?? r.yes_price) : 1 - r.yes_price;
        if (price <= 0 || price >= 1) continue;
        const days = Math.max(0.25, (r.end_ts - t) / 86400);
        const gross = (1 - price) / price;
        const dr = disputeRisk(r);
        out.push({ condition_id: r.condition_id, question: r.question, side, price, daysToEnd: Math.round(days * 10) / 10, grossYield: gross, annualized: gross * (365 / days), disputeRisk: dr.score, reasons: dr.reasons });
    }
    return out.sort((a, b) => b.annualized - a.annualized).slice(0, opts.limit ?? 50);
}
