import { openDb, stmt, all, get, run, now, transaction, kvGet, kvSet } from '../pm/db';

/**
 * Paper copy-trading engine (spec §5). No live execution exists in this repo: every "order" is a row in
 * paper_orders. The risk controls are the ones a live adapter would need: price offset cap, proportional sizing,
 * category filter, per-trade / daily / per-market caps, liquidity floor, exit mirroring, paper-first.
 */

export function ensureSchema() {
    openDb().exec(`
    CREATE TABLE IF NOT EXISTS copy_seen (trade_id TEXT PRIMARY KEY, strategy TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_paper_orders_strategy ON paper_orders(strategy, status);
    CREATE INDEX IF NOT EXISTS idx_paper_orders_market ON paper_orders(condition_id, outcome_index);
    `);
}

export interface Leader { address: string; categories?: string[]; weight?: number }

export interface CopyConfig {
    strategy: string;                 // paper_orders.strategy label
    myBankroll: number;               // USD
    maxPriceOffsetCents: number;      // never pay more than leader fill + this
    proportionalPct?: number;         // copy this % of the leader's relative size (default 100 = same fraction of bankroll)
    fixedUsdPerTrade?: number;        // alternative to proportional sizing
    perTradeCap: number;
    dailyCap: number;
    perMarketCap: number;
    minLiquidityUsd: number;
    categoryFilter?: string[];        // allow-list; empty/undefined = all
    exitMirroring: boolean;
    skipScalps?: boolean;             // default true: ignore up/down 5m-15m markets
    initialLookbackSec?: number;      // first poll only: how far back to start copying (default 1h). Never replay history.
}

export const DEFAULT_COPY_CONFIG: CopyConfig = {
    strategy: 'copy', myBankroll: 10_000, maxPriceOffsetCents: 2, proportionalPct: 100, perTradeCap: 500, dailyCap: 2_000,
    perMarketCap: 1_000, minLiquidityUsd: 5_000, exitMirroring: true, skipScalps: true, initialLookbackSec: 3600
};

interface TradeRow { id: string; wallet: string; condition_id: string; outcome_index: number; side: string; size: number; price: number; usdc: number; ts: number; event_slug: string; title: string }
interface MarketRow { category: string; liquidity: number; yes_price: number; best_bid: number; best_ask: number; resolved: number; winner_index: number | null }

const SCALP_RE = /updown|up-or-down/i;

/** Leader bankroll estimate = latest position snapshot's Σ initial_value, else Σ BUY usdc over the last 30 days. */
export function leaderBankroll(address: string, at = now()): number {
    const snap = get<{ ts: number }>('SELECT MAX(ts) ts FROM position_snapshots WHERE wallet = ?', address);
    if (snap?.ts) {
        const v = get<{ v: number }>('SELECT SUM(initial_value) v FROM position_snapshots WHERE wallet = ? AND ts = ?', address, snap.ts)?.v ?? 0;
        if (v > 0) return v;
    }
    return get<{ v: number }>("SELECT SUM(usdc) v FROM trades WHERE wallet = ? AND side = 'BUY' AND ts > ?", address, at - 30 * 86_400)?.v ?? 0;
}

/** Current mid for an outcome from the markets table (yes_price for index 0, 1−yes for index 1). null if unknown. */
export function currentMid(m: MarketRow | undefined, outcomeIndex: number): number | null {
    if (!m) return null;
    let yes: number | null = null;
    if (m.best_bid && m.best_ask) yes = (m.best_bid + m.best_ask) / 2;
    else if (m.yes_price !== null && m.yes_price !== undefined) yes = m.yes_price;
    if (yes === null) return null;
    return outcomeIndex === 0 ? yes : 1 - yes;
}

export interface PollResult { seen: number; placed: number; rejected: Record<string, number>; closed: number }

/** Decide + size one leader BUY. Pure given the inputs (exported for tests). */
export function decideCopy(t: TradeRow, m: MarketRow | undefined, cfg: CopyConfig, ctx: { leaderBankroll: number; openInMarket: number; spentToday: number; mid: number | null; leaderCategories?: string[] }): { ok: true; price: number; usd: number; size: number } | { ok: false; reason: string } {
    if (t.side !== 'BUY') return { ok: false, reason: 'not_buy' };
    if (cfg.skipScalps !== false && SCALP_RE.test(t.event_slug)) return { ok: false, reason: 'scalp' };
    const cat = m?.category ?? 'other';
    if (cfg.categoryFilter?.length && !cfg.categoryFilter.includes(cat)) return { ok: false, reason: 'category' };
    if (ctx.leaderCategories?.length && !ctx.leaderCategories.includes(cat)) return { ok: false, reason: 'leader_category' };
    if ((m?.liquidity ?? 0) < cfg.minLiquidityUsd) return { ok: false, reason: 'liquidity' };
    const cap = t.price + cfg.maxPriceOffsetCents / 100;
    const price = ctx.mid === null ? t.price : ctx.mid;
    if (price > cap + 1e-9) return { ok: false, reason: 'price_moved' };
    if (price >= 0.995) return { ok: false, reason: 'price_too_high' };
    let usd: number;
    if (cfg.fixedUsdPerTrade) usd = cfg.fixedUsdPerTrade;
    else {
        if (ctx.leaderBankroll <= 0) return { ok: false, reason: 'no_leader_bankroll' };
        usd = (t.usdc / ctx.leaderBankroll) * cfg.myBankroll * ((cfg.proportionalPct ?? 100) / 100);
    }
    usd = Math.min(usd, cfg.perTradeCap, cfg.perMarketCap - ctx.openInMarket, cfg.dailyCap - ctx.spentToday);
    if (usd < 1) return { ok: false, reason: 'cap' };
    return { ok: true, price, usd, size: usd / price };
}

/** Read new leader trades from `trades` (since the strategy cursor) and write paper orders. */
export function pollLeaders(leaders: Leader[], cfg: CopyConfig = DEFAULT_COPY_CONFIG, at = now()): PollResult {
    ensureSchema();
    const res: PollResult = { seen: 0, placed: 0, rejected: {}, closed: 0 };
    const cursorKey = `copy:cursor:${cfg.strategy}`;
    const cursor = kvGet<number>(cursorKey) ?? (at - (cfg.initialLookbackSec ?? 3600));
    let maxTs = cursor;
    const dayStart = at - (at % 86_400);
    let spentToday = get<{ v: number }>("SELECT COALESCE(SUM(usd),0) v FROM paper_orders WHERE strategy = ? AND side = 'BUY' AND status != 'rejected' AND ts >= ?", cfg.strategy, dayStart)?.v ?? 0;
    const bankrolls = new Map<string, number>();

    for (const L of leaders) {
        const addr = L.address.toLowerCase();
        const rows = all<TradeRow>('SELECT id, wallet, condition_id, outcome_index, side, size, price, usdc, ts, event_slug, title FROM trades WHERE wallet = ? AND ts >= ? ORDER BY ts ASC', addr, cursor);
        for (const t of rows) {
            if (get('SELECT 1 FROM copy_seen WHERE trade_id = ? AND strategy = ?', t.id, cfg.strategy)) continue;
            res.seen++; maxTs = Math.max(maxTs, t.ts);
            run('INSERT OR IGNORE INTO copy_seen(trade_id, strategy, ts) VALUES (?,?,?)', t.id, cfg.strategy, t.ts);
            const m = get<MarketRow>('SELECT category, liquidity, yes_price, best_bid, best_ask, resolved, winner_index FROM markets WHERE condition_id = ?', t.condition_id);

            if (t.side === 'SELL') {
                if (!cfg.exitMirroring) continue;
                // Close our open copies of this leader in this market at the leader's sell price.
                const open = all<{ id: number; price: number; size: number; usd: number }>("SELECT id, price, size, usd FROM paper_orders WHERE strategy = ? AND wallet = ? AND condition_id = ? AND outcome_index = ? AND side = 'BUY' AND status = 'open'", cfg.strategy, addr, t.condition_id, t.outcome_index);
                for (const o of open) {
                    run("UPDATE paper_orders SET status = 'closed', close_price = ?, close_ts = ?, pnl = ? WHERE id = ?", t.price, t.ts, o.size * t.price - o.usd, o.id);
                    res.closed++;
                }
                continue;
            }

            if (!bankrolls.has(addr)) bankrolls.set(addr, leaderBankroll(addr, at));
            const openInMarket = get<{ v: number }>("SELECT COALESCE(SUM(usd),0) v FROM paper_orders WHERE strategy = ? AND condition_id = ? AND side = 'BUY' AND status = 'open'", cfg.strategy, t.condition_id)?.v ?? 0;
            const d = decideCopy(t, m, cfg, { leaderBankroll: bankrolls.get(addr)!, openInMarket, spentToday, mid: currentMid(m, t.outcome_index), leaderCategories: L.categories });
            if (!d.ok) {
                res.rejected[d.reason] = (res.rejected[d.reason] ?? 0) + 1;
                run("INSERT INTO paper_orders(strategy, ts, wallet, condition_id, outcome_index, side, price, size, usd, reason, status) VALUES (?,?,?,?,?,?,?,?,?,?,'rejected')", cfg.strategy, t.ts, addr, t.condition_id, t.outcome_index, 'BUY', t.price, 0, 0, `${d.reason} | leader ${t.title.slice(0, 60)} @${t.price} $${Math.round(t.usdc)}`);
                continue;
            }
            run("INSERT INTO paper_orders(strategy, ts, wallet, condition_id, outcome_index, side, price, size, usd, reason, status) VALUES (?,?,?,?,?,?,?,?,?,?,'open')", cfg.strategy, t.ts, addr, t.condition_id, t.outcome_index, 'BUY', d.price, d.size, d.usd, `copy ${t.title.slice(0, 60)} | leader @${t.price} $${Math.round(t.usdc)}`);
            spentToday += d.usd; res.placed++;
        }
    }
    kvSet(cursorKey, maxTs);
    return res;
}

/** Settle open paper orders whose market resolved. */
export function settlePaper(strategy?: string): number {
    ensureSchema();
    const rows = strategy
        ? all<{ id: number; condition_id: string; outcome_index: number; size: number; usd: number; winner_index: number; end_ts: number }>("SELECT o.id, o.condition_id, o.outcome_index, o.size, o.usd, m.winner_index, m.end_ts FROM paper_orders o JOIN markets m ON m.condition_id = o.condition_id WHERE o.status = 'open' AND m.resolved = 1 AND o.strategy = ?", strategy)
        : all<{ id: number; condition_id: string; outcome_index: number; size: number; usd: number; winner_index: number; end_ts: number }>("SELECT o.id, o.condition_id, o.outcome_index, o.size, o.usd, m.winner_index, m.end_ts FROM paper_orders o JOIN markets m ON m.condition_id = o.condition_id WHERE o.status = 'open' AND m.resolved = 1");
    transaction(() => {
        for (const r of rows) {
            const won = r.winner_index === r.outcome_index;
            run("UPDATE paper_orders SET status = 'resolved', close_price = ?, close_ts = ?, pnl = ? WHERE id = ?", won ? 1 : 0, r.end_ts ?? now(), (won ? r.size : 0) - r.usd, r.id);
        }
    });
    return rows.length;
}

/** Kill switch: close every open paper order at current mid (or entry price when unknown). */
export function cancelAllPaper(strategy?: string, at = now()): number {
    ensureSchema();
    const rows = strategy
        ? all<{ id: number; condition_id: string; outcome_index: number; price: number; size: number; usd: number }>("SELECT id, condition_id, outcome_index, price, size, usd FROM paper_orders WHERE status = 'open' AND strategy = ?", strategy)
        : all<{ id: number; condition_id: string; outcome_index: number; price: number; size: number; usd: number }>("SELECT id, condition_id, outcome_index, price, size, usd FROM paper_orders WHERE status = 'open'");
    transaction(() => {
        for (const r of rows) {
            const m = get<MarketRow>('SELECT category, liquidity, yes_price, best_bid, best_ask, resolved, winner_index FROM markets WHERE condition_id = ?', r.condition_id);
            const px = currentMid(m, r.outcome_index) ?? r.price;
            run("UPDATE paper_orders SET status = 'closed', close_price = ?, close_ts = ?, pnl = ? WHERE id = ?", px, at, r.size * px - r.usd, r.id);
        }
    });
    return rows.length;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface PaperReportRow { strategy: string; open: number; closed: number; resolved: number; rejected: number; usdOpen: number; pnl: number; wins: number; losses: number; hitRate: number }
export function paperReport(): PaperReportRow[] {
    ensureSchema();
    return all<{ strategy: string; open: number; closed: number; resolved: number; rejected: number; usdOpen: number; pnl: number; wins: number; losses: number }>(
        `SELECT strategy,
            SUM(status='open') open, SUM(status='closed') closed, SUM(status='resolved') resolved, SUM(status='rejected') rejected,
            COALESCE(SUM(CASE WHEN status='open' THEN usd END),0) usdOpen,
            COALESCE(SUM(pnl),0) pnl,
            SUM(pnl > 0) wins, SUM(pnl < 0) losses
         FROM paper_orders GROUP BY strategy`).map(r => ({ ...r, hitRate: r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0 }));
}

/** Leader's realized P/L on a market+outcome from their trades, settled at resolution (buys − sells − remainder). */
export function leaderRealized(address: string, conditionId: string, outcomeIndex: number): { pnl: number; staked: number } | null {
    const m = get<{ winner_index: number }>('SELECT winner_index FROM markets WHERE condition_id = ? AND resolved = 1', conditionId);
    if (!m) return null;
    const ts = all<{ side: string; size: number; usdc: number }>('SELECT side, size, usdc FROM trades WHERE wallet = ? AND condition_id = ? AND outcome_index = ?', address, conditionId, outcomeIndex);
    let bought = 0, cost = 0, sold = 0, proceeds = 0;
    for (const t of ts) { if (t.side === 'BUY') { bought += t.size; cost += t.usdc; } else { sold += t.size; proceeds += t.usdc; } }
    const held = Math.max(0, bought - sold);
    return { pnl: proceeds + (m.winner_index === outcomeIndex ? held : 0) - cost, staked: cost };
}

export interface CopyLagRow { leader: string; markets: number; ourPnl: number; ourStaked: number; leaderPnl: number; leaderStaked: number; offsetCost: number; ourRoi: number; leaderRoi: number }
/** Our paper P/L vs the leader's own on the same resolved markets. offsetCost = Σ size × (our fill − leader fill). */
export function copyLagReport(strategy: string): CopyLagRow[] {
    ensureSchema();
    const rows = all<{ wallet: string; condition_id: string; outcome_index: number; size: number; price: number; usd: number; pnl: number; reason: string }>(
        "SELECT wallet, condition_id, outcome_index, size, price, usd, pnl, reason FROM paper_orders WHERE strategy = ? AND status = 'resolved' AND side = 'BUY' AND wallet IS NOT NULL", strategy);
    const byLeader = new Map<string, CopyLagRow & { seen: Set<string> }>();
    for (const r of rows) {
        const L = byLeader.get(r.wallet) ?? { leader: r.wallet, markets: 0, ourPnl: 0, ourStaked: 0, leaderPnl: 0, leaderStaked: 0, offsetCost: 0, ourRoi: 0, leaderRoi: 0, seen: new Set<string>() };
        L.ourPnl += r.pnl; L.ourStaked += r.usd;
        const lp = /@([0-9.]+)/.exec(r.reason)?.[1]; // leader fill recorded in reason
        if (lp) L.offsetCost += r.size * (r.price - parseFloat(lp));
        const k = `${r.condition_id}|${r.outcome_index}`;
        if (!L.seen.has(k)) { L.seen.add(k); L.markets++; const lr = leaderRealized(r.wallet, r.condition_id, r.outcome_index); if (lr) { L.leaderPnl += lr.pnl; L.leaderStaked += lr.staked; } }
        byLeader.set(r.wallet, L);
    }
    return Array.from(byLeader.values()).map(L => ({ leader: L.leader, markets: L.markets, ourPnl: L.ourPnl, ourStaked: L.ourStaked, leaderPnl: L.leaderPnl, leaderStaked: L.leaderStaked, offsetCost: L.offsetCost, ourRoi: L.ourStaked ? L.ourPnl / L.ourStaked : 0, leaderRoi: L.leaderStaked ? L.leaderPnl / L.leaderStaked : 0 }));
}

/**
 * Price of an outcome shortly before `ts`: latest `prices` point in [ts−windowSec, ts) for the outcome's CLOB token,
 * else the last trade (any wallet) in that market+outcome in the window. null when neither exists.
 */
export function priceBefore(conditionId: string, outcomeIndex: number, ts: number, windowSec: number): number | null {
    const m = get<{ clob_token_ids: string }>('SELECT clob_token_ids FROM markets WHERE condition_id = ?', conditionId);
    const tok = m ? (JSON.parse(m.clob_token_ids || '[]') as string[])[outcomeIndex] : undefined;
    if (tok) {
        const p = get<{ price: number }>('SELECT price FROM prices WHERE token_id = ? AND ts >= ? AND ts < ? ORDER BY ts DESC LIMIT 1', tok, ts - windowSec, ts);
        if (p) return p.price;
    }
    const t = get<{ price: number }>('SELECT price FROM trades WHERE condition_id = ? AND outcome_index = ? AND ts >= ? AND ts < ? ORDER BY ts DESC LIMIT 1', conditionId, outcomeIndex, ts - windowSec, ts);
    return t ? t.price : null;
}

/** Share of a leader's BUYs preceded by a ≥ 2¢ rise in the 10 minutes before (others copying / front-running them). */
export function frontRunDetection(address: string, lookbackDays = 30, riseCents = 2, windowSec = 600, at = now()): { buys: number; measurable: number; preRun: number; share: number } {
    const buys = all<{ condition_id: string; outcome_index: number; price: number; ts: number }>("SELECT condition_id, outcome_index, price, ts FROM trades WHERE wallet = ? AND side = 'BUY' AND ts > ? ORDER BY ts DESC LIMIT 2000", address, at - lookbackDays * 86_400);
    let measurable = 0, preRun = 0;
    for (const b of buys) {
        const before = priceBefore(b.condition_id, b.outcome_index, b.ts - 1, windowSec);
        if (before === null) continue;
        measurable++;
        if (b.price - before >= riseCents / 100) preRun++;
    }
    return { buys: buys.length, measurable, preRun, share: measurable ? preRun / measurable : 0 };
}

export interface DumpAlert { conditionId: string; outcomeIndex: number; buyTs: number; sellTs: number; buyUsd: number; sellUsd: number; othersBuyBetween: number; othersBuyBefore: number }
/** Leader sells within `withinSec` after their own BUY while other wallets' BUY volume in that market rose. */
export function leaderDumpingAlert(address: string, lookbackDays = 30, withinSec = 3600, at = now()): DumpAlert[] {
    const ts = all<{ condition_id: string; outcome_index: number; side: string; usdc: number; ts: number }>('SELECT condition_id, outcome_index, side, usdc, ts FROM trades WHERE wallet = ? AND ts > ? ORDER BY ts ASC', address, at - lookbackDays * 86_400);
    const out: DumpAlert[] = [];
    const lastBuy = new Map<string, { ts: number; usdc: number }>();
    for (const t of ts) {
        const k = `${t.condition_id}|${t.outcome_index}`;
        if (t.side === 'BUY') { lastBuy.set(k, { ts: t.ts, usdc: t.usdc }); continue; }
        const b = lastBuy.get(k);
        if (!b || t.ts - b.ts > withinSec) continue;
        const between = get<{ v: number }>("SELECT COALESCE(SUM(usdc),0) v FROM trades WHERE condition_id = ? AND outcome_index = ? AND side = 'BUY' AND wallet != ? AND ts > ? AND ts <= ?", t.condition_id, t.outcome_index, address, b.ts, t.ts)?.v ?? 0;
        const before = get<{ v: number }>("SELECT COALESCE(SUM(usdc),0) v FROM trades WHERE condition_id = ? AND outcome_index = ? AND side = 'BUY' AND wallet != ? AND ts > ? AND ts <= ?", t.condition_id, t.outcome_index, address, b.ts - (t.ts - b.ts), b.ts)?.v ?? 0;
        if (between > before) out.push({ conditionId: t.condition_id, outcomeIndex: t.outcome_index, buyTs: b.ts, sellTs: t.ts, buyUsd: b.usdc, sellUsd: t.usdc, othersBuyBetween: between, othersBuyBefore: before });
        lastBuy.delete(k);
    }
    return out;
}

/** Realized ROI of a wallet over resolved markets in the lookback (from trades + markets). */
export function recentRealizedRoi(address: string, lookbackDays: number, at = now()): { roi: number; n: number; staked: number; pnl: number } {
    const rows = all<{ condition_id: string; outcome_index: number; side: string; size: number; usdc: number; winner_index: number }>(
        `SELECT t.condition_id, t.outcome_index, t.side, t.size, t.usdc, m.winner_index FROM trades t JOIN markets m ON m.condition_id = t.condition_id
         WHERE t.wallet = ? AND t.ts > ? AND m.resolved = 1 AND (t.event_slug IS NULL OR t.event_slug NOT LIKE '%updown%')`, address, at - lookbackDays * 86_400);
    const g = new Map<string, { bought: number; cost: number; sold: number; proceeds: number; win: number }>();
    for (const r of rows) {
        const k = `${r.condition_id}|${r.outcome_index}`; const x = g.get(k) ?? { bought: 0, cost: 0, sold: 0, proceeds: 0, win: r.winner_index === r.outcome_index ? 1 : 0 };
        if (r.side === 'BUY') { x.bought += r.size; x.cost += r.usdc; } else { x.sold += r.size; x.proceeds += r.usdc; }
        g.set(k, x);
    }
    let staked = 0, pnl = 0, n = 0;
    for (const x of Array.from(g.values())) { if (x.cost <= 0) continue; n++; staked += x.cost; pnl += x.proceeds + (x.win ? Math.max(0, x.bought - x.sold) : 0) - x.cost; }
    return { roi: staked ? pnl / staked : 0, n, staked, pnl };
}

export interface BasketWeight { address: string; weight: number; score: number; n: number; source: 'wallet_scores' | 'realized' }
/** Weight ≤ 10 leaders by recent performance: wallet_scores.calibrated_roi (all, 30d) when present, else realized ROI. Cap 25 % each. */
export function rebalanceBasket(leaders: string[], lookbackDays = 30, at = now()): BasketWeight[] {
    openDb();
    const rows: BasketWeight[] = leaders.map(a => {
        const addr = a.toLowerCase();
        const ws = get<{ calibrated_roi: number; n_resolved: number }>("SELECT calibrated_roi, n_resolved FROM wallet_scores WHERE wallet = ? AND category = 'all' AND window_days = ?", addr, lookbackDays);
        if (ws && ws.n_resolved >= 10 && ws.calibrated_roi !== null) return { address: addr, weight: 0, score: ws.calibrated_roi, n: ws.n_resolved, source: 'wallet_scores' as const };
        const r = recentRealizedRoi(addr, lookbackDays, at);
        return { address: addr, weight: 0, score: r.n >= 5 ? r.roi : -1, n: r.n, source: 'realized' as const };
    });
    const pos = rows.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);
    if (!pos.length) return rows.map(r => ({ ...r, weight: 0 }));
    // Proportional to score, capped at 25 %, redistributing excess iteratively.
    let weights = pos.map(r => r.score);
    for (let iter = 0; iter < 20; iter++) {
        const sum = weights.reduce((s, w) => s + w, 0);
        weights = weights.map(w => w / sum);
        const over = weights.map(w => Math.max(0, w - 0.25));
        const excess = over.reduce((s, o) => s + o, 0);
        if (excess < 1e-9) break;
        const under = weights.map((w, i) => (over[i] > 0 ? 0 : w));
        const underSum = under.reduce((s, u) => s + u, 0);
        weights = weights.map((w, i) => (over[i] > 0 ? 0.25 : (underSum > 0 ? w + excess * (under[i] / underSum) : w)));
    }
    const wmap = new Map(pos.map((r, i) => [r.address, weights[i]] as [string, number]));
    return rows.map(r => ({ ...r, weight: wmap.get(r.address) ?? 0 }));
}
