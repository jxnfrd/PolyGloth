import { openDb, stmt, all, get, run, now } from '../pm/db';
import { BookLevel, walkBook } from '../pm/clob';

/**
 * Risk, sizing and calibration (spec §9).
 * Every formula here is pure and unit-tested with hand-checked numbers (tests/risk.test.ts).
 */

export function ensureSchema() {
    openDb().exec(`
    CREATE TABLE IF NOT EXISTS calibration_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      who TEXT NOT NULL,                 -- wallet or user label
      condition_id TEXT NOT NULL,
      outcome_index INTEGER NOT NULL,
      prob_estimate REAL NOT NULL,       -- your probability that outcome_index wins
      market_price REAL NOT NULL,        -- price of that outcome at the time
      outcome INTEGER                    -- 1 = outcome_index won, 0 = lost, NULL = unresolved
    );
    CREATE INDEX IF NOT EXISTS idx_calib_who ON calibration_log(who, ts DESC);
    `);
}

// ---------------------------------------------------------------------------
// Expected value + Kelly
// ---------------------------------------------------------------------------

/** EV per $1 of contract face value when buying an outcome at price p with your probability q. */
export const ev = (q: number, p: number): number => q - p;

/** Full-Kelly fraction of bankroll for buying an outcome at price p with probability q. 0 if no edge. */
export function kelly(q: number, p: number): number {
    if (!(p > 0 && p < 1) || !(q >= 0 && q <= 1)) return 0;
    const f = (q - p) / (1 - p);
    return f > 0 ? f : 0;
}

/** Kelly for buying NO: NO price is 1−p, NO wins with probability 1−q. */
export const kellyNo = (q: number, p: number): number => kelly(1 - q, 1 - p);

export type KellyFraction = 1 | 0.5 | 0.25 | 0.125;
export function fractionalKelly(q: number, p: number, fraction: KellyFraction = 0.25): number { return kelly(q, p) * fraction; }

/** Best side and its Kelly given your probability q for YES. */
export function bestSide(q: number, yesPrice: number): { side: 'YES' | 'NO' | 'NONE'; kelly: number; ev: number } {
    const y = kelly(q, yesPrice), n = kellyNo(q, yesPrice);
    if (y <= 0 && n <= 0) return { side: 'NONE', kelly: 0, ev: 0 };
    return y >= n ? { side: 'YES', kelly: y, ev: ev(q, yesPrice) } : { side: 'NO', kelly: n, ev: ev(1 - q, 1 - yesPrice) };
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

/** Kalshi trading fee in dollars: 0.07 × contracts × p × (1−p), rounded UP to the cent. Peaks at p = 0.5. */
export function kalshiFee(contracts: number, p: number): number {
    const raw = 0.07 * contracts * p * (1 - p);
    return Math.ceil(raw * 100 - 1e-9) / 100;
}

/** Polymarket: no taker fee on most markets. `bps` lets you model a fee/rebate anyway. */
export function polymarketFee(usd: number, bps = 0): number { return usd * bps / 10_000; }

// ---------------------------------------------------------------------------
// Liquidity-adjusted sizing
// ---------------------------------------------------------------------------

/**
 * Largest USD buy such that the average fill price stays ≤ fairValue − margin, walking the ask book.
 * Also capped by `maxUsd` (e.g. Kelly × bankroll). Returns 0 if even the best ask is above the cap.
 */
export function liquidityAdjustedSize(asks: BookLevel[], fairValue: number, margin: number, maxUsd: number): { usd: number; shares: number; avgPrice: number } {
    const cap = fairValue - margin;
    if (!asks.length || asks[0].price > cap || maxUsd <= 0) return { usd: 0, shares: 0, avgPrice: 0 };
    // If the whole budget fits under the cap, take it exactly (avoid binary-search rounding).
    const full = walkBook(asks, 'BUY', maxUsd);
    if (full.filled >= maxUsd - 1e-9 && full.avgPrice <= cap) return { usd: full.filled, shares: full.shares, avgPrice: full.avgPrice };
    // Binary search on USD (walkBook is monotone in avg price).
    let lo = 0, hi = maxUsd;
    for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const w = walkBook(asks, 'BUY', mid);
        if (w.filled < mid - 1e-6 || w.avgPrice > cap) hi = mid; else lo = mid;
    }
    const w = walkBook(asks, 'BUY', lo);
    return { usd: w.filled, shares: w.shares, avgPrice: w.avgPrice };
}

// ---------------------------------------------------------------------------
// Resolution-risk haircut
// ---------------------------------------------------------------------------

export interface ResolutionRiskFlags { ambiguousRules?: boolean; umaDisputeHistory?: boolean; canCloseEarly?: boolean; thinResolutionSource?: boolean; multiOutcomeNegRisk?: boolean }
/** Multiplicative haircuts (explicit table, product of applicable factors). */
export const HAIRCUTS: Record<keyof ResolutionRiskFlags, number> = { ambiguousRules: 0.5, umaDisputeHistory: 0.6, canCloseEarly: 0.8, thinResolutionSource: 0.7, multiOutcomeNegRisk: 0.9 };
export function resolutionHaircut(flags: ResolutionRiskFlags): number {
    return (Object.keys(HAIRCUTS) as (keyof ResolutionRiskFlags)[]).reduce((f, k) => (flags[k] ? f * HAIRCUTS[k] : f), 1);
}

// ---------------------------------------------------------------------------
// Calibration tracker (Brier / log loss / reliability)
// ---------------------------------------------------------------------------

export function logEstimate(who: string, conditionId: string, outcomeIndex: number, probEstimate: number, marketPrice: number, ts = now()): number {
    ensureSchema();
    const r = stmt('INSERT INTO calibration_log(ts, who, condition_id, outcome_index, prob_estimate, market_price) VALUES (?,?,?,?,?,?)').run(ts, who, conditionId.toLowerCase(), outcomeIndex, probEstimate, marketPrice);
    return Number(r.lastInsertRowid);
}

/** Fill outcomes from resolved markets. Returns rows updated. */
export function settleCalibration(): number {
    ensureSchema();
    const r = run(`UPDATE calibration_log SET outcome = (SELECT CASE WHEN m.winner_index = calibration_log.outcome_index THEN 1 ELSE 0 END FROM markets m WHERE m.condition_id = calibration_log.condition_id AND m.resolved = 1)
                   WHERE outcome IS NULL AND EXISTS (SELECT 1 FROM markets m WHERE m.condition_id = calibration_log.condition_id AND m.resolved = 1)`);
    return Number(r.changes);
}

export interface CalibrationReport { n: number; brier: number; marketBrier: number; logLoss: number; bins: { lo: number; hi: number; n: number; meanEstimate: number; observed: number }[] }

export function scoreCalibrationFrom(rows: { prob_estimate: number; market_price: number; outcome: number }[]): CalibrationReport {
    const n = rows.length;
    const clamp = (x: number) => Math.min(1 - 1e-6, Math.max(1e-6, x));
    let brier = 0, mb = 0, ll = 0;
    const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, sumEst: 0, sumOut: 0 }));
    for (const r of rows) {
        brier += (r.prob_estimate - r.outcome) ** 2;
        mb += (r.market_price - r.outcome) ** 2;
        const q = clamp(r.prob_estimate);
        ll += -(r.outcome * Math.log(q) + (1 - r.outcome) * Math.log(1 - q));
        const b = bins[Math.min(9, Math.floor(r.prob_estimate * 10))];
        b.n++; b.sumEst += r.prob_estimate; b.sumOut += r.outcome;
    }
    return {
        n, brier: n ? brier / n : NaN, marketBrier: n ? mb / n : NaN, logLoss: n ? ll / n : NaN,
        bins: bins.map(b => ({ lo: b.lo, hi: b.hi, n: b.n, meanEstimate: b.n ? b.sumEst / b.n : NaN, observed: b.n ? b.sumOut / b.n : NaN }))
    };
}

export function scoreCalibration(who?: string): CalibrationReport {
    ensureSchema();
    settleCalibration();
    const rows = who
        ? all<{ prob_estimate: number; market_price: number; outcome: number }>('SELECT prob_estimate, market_price, outcome FROM calibration_log WHERE outcome IS NOT NULL AND who = ?', who)
        : all<{ prob_estimate: number; market_price: number; outcome: number }>('SELECT prob_estimate, market_price, outcome FROM calibration_log WHERE outcome IS NOT NULL');
    return scoreCalibrationFrom(rows);
}

// ---------------------------------------------------------------------------
// Scenario P/L + correlated exposure
// ---------------------------------------------------------------------------

export interface PortfolioPosition { conditionId: string; outcomeIndex: number; shares: number; cost: number; eventKey?: string; negRisk?: boolean; nOutcomes?: number }
export interface Scenario { conditionId: string; label: string; pnl: number }
export interface ScenarioReport { scenarios: Scenario[]; worst: Scenario | null; best: Scenario | null; exposureByEvent: { eventKey: string; netAtRisk: number; positions: number }[] }

/**
 * P/L for "market X resolves to outcome 0 (YES)" and "… outcome 1 (NO)" for every market held; for neg-risk events
 * (mutually exclusive outcomes), "X resolves YES" also resolves every sibling market in that event to NO.
 * Unmentioned markets are marked at cost (P/L 0), so each scenario isolates one underlying outcome.
 */
export function scenarioPnl(positions: PortfolioPosition[], eventOf?: (conditionId: string) => { eventKey: string; negRisk: boolean } | undefined): ScenarioReport {
    const meta = (cid: string) => eventOf?.(cid) ?? { eventKey: cid, negRisk: false };
    const markets = Array.from(new Set(positions.map(p => p.conditionId)));
    const pnlIf = (cid: string, winner: number): number => {
        const m = meta(cid);
        let pnl = 0;
        for (const p of positions) {
            const pm = meta(p.conditionId);
            let outcomeOfP: number | null = null;
            if (p.conditionId === cid) outcomeOfP = winner;
            else if (m.negRisk && pm.eventKey === m.eventKey && winner === 0) outcomeOfP = 1; // sibling must be NO when this one is YES
            if (outcomeOfP === null) continue;
            pnl += (outcomeOfP === p.outcomeIndex ? p.shares : 0) - p.cost;
        }
        return pnl;
    };
    const scenarios: Scenario[] = [];
    for (const cid of markets) {
        scenarios.push({ conditionId: cid, label: `${cid.slice(0, 10)} → YES`, pnl: pnlIf(cid, 0) });
        scenarios.push({ conditionId: cid, label: `${cid.slice(0, 10)} → NO`, pnl: pnlIf(cid, 1) });
    }
    const sorted = [...scenarios].sort((a, b) => a.pnl - b.pnl);
    const byEvent = new Map<string, { netAtRisk: number; positions: number }>();
    for (const p of positions) { const k = meta(p.conditionId).eventKey; const e = byEvent.get(k) ?? { netAtRisk: 0, positions: 0 }; e.netAtRisk += p.cost; e.positions++; byEvent.set(k, e); }
    return { scenarios, worst: sorted[0] ?? null, best: sorted[sorted.length - 1] ?? null, exposureByEvent: Array.from(byEvent.entries()).map(([eventKey, v]) => ({ eventKey, ...v })).sort((a, b) => b.netAtRisk - a.netAtRisk) };
}

/** Load the paper portfolio (open paper_orders) with event mapping from the markets table. */
export function paperPortfolio(strategy?: string): { positions: PortfolioPosition[]; eventOf: (cid: string) => { eventKey: string; negRisk: boolean } | undefined } {
    openDb();
    const rows = strategy
        ? all<{ condition_id: string; outcome_index: number; size: number; usd: number }>("SELECT condition_id, outcome_index, size, usd FROM paper_orders WHERE status = 'open' AND side = 'BUY' AND strategy = ?", strategy)
        : all<{ condition_id: string; outcome_index: number; size: number; usd: number }>("SELECT condition_id, outcome_index, size, usd FROM paper_orders WHERE status = 'open' AND side = 'BUY'");
    const agg = new Map<string, PortfolioPosition>();
    for (const r of rows) { const k = `${r.condition_id}|${r.outcome_index}`; const p = agg.get(k) ?? { conditionId: r.condition_id, outcomeIndex: r.outcome_index, shares: 0, cost: 0 }; p.shares += r.size; p.cost += r.usd; agg.set(k, p); }
    const cache = new Map<string, { eventKey: string; negRisk: boolean } | undefined>();
    const eventOf = (cid: string) => {
        if (cache.has(cid)) return cache.get(cid);
        const m = get<{ event_slug: string; event_id: string; neg_risk: number }>('SELECT event_slug, event_id, neg_risk FROM markets WHERE condition_id = ?', cid);
        const v = m ? { eventKey: m.event_id || m.event_slug || cid, negRisk: m.neg_risk === 1 } : undefined;
        cache.set(cid, v); return v;
    };
    return { positions: Array.from(agg.values()), eventOf };
}

// ---------------------------------------------------------------------------
// Drawdown circuit breaker + tilt + time value
// ---------------------------------------------------------------------------

export interface PnlEvent { ts: number; pnl: number }
export interface BreakerLimits { dailyLossLimit: number; weeklyLossLimit: number }
/** Pure: sums realized P/L in the trailing 24h / 7d windows ending at `at`. Halts when either loss exceeds its limit. */
export function breaker(events: PnlEvent[], limits: BreakerLimits, at = now()): { halted: boolean; reason: string; dayPnl: number; weekPnl: number } {
    const dayPnl = events.filter(e => e.ts > at - 86_400 && e.ts <= at).reduce((s, e) => s + e.pnl, 0);
    const weekPnl = events.filter(e => e.ts > at - 7 * 86_400 && e.ts <= at).reduce((s, e) => s + e.pnl, 0);
    if (-dayPnl >= limits.dailyLossLimit) return { halted: true, reason: `daily loss ${dayPnl.toFixed(2)} ≤ -${limits.dailyLossLimit}`, dayPnl, weekPnl };
    if (-weekPnl >= limits.weeklyLossLimit) return { halted: true, reason: `weekly loss ${weekPnl.toFixed(2)} ≤ -${limits.weeklyLossLimit}`, dayPnl, weekPnl };
    return { halted: false, reason: '', dayPnl, weekPnl };
}

export function paperPnlEvents(strategy?: string): PnlEvent[] {
    openDb();
    const rows = strategy
        ? all<{ close_ts: number; pnl: number }>("SELECT close_ts, pnl FROM paper_orders WHERE pnl IS NOT NULL AND close_ts IS NOT NULL AND strategy = ?", strategy)
        : all<{ close_ts: number; pnl: number }>("SELECT close_ts, pnl FROM paper_orders WHERE pnl IS NOT NULL AND close_ts IS NOT NULL");
    return rows.map(r => ({ ts: r.close_ts, pnl: r.pnl }));
}

/** Tilt: average order size after a losing close vs after a winning close (chronological). Ratio > 1.3 = tilt. */
export function tiltDetector(orders: { ts: number; usd: number }[], closes: { ts: number; pnl: number }[]): { afterLoss: number; afterWin: number; ratio: number; tilted: boolean; n: number } {
    const sortedCloses = [...closes].sort((a, b) => a.ts - b.ts);
    let sl = 0, nl = 0, sw = 0, nw = 0;
    for (const o of [...orders].sort((a, b) => a.ts - b.ts)) {
        let last: { ts: number; pnl: number } | null = null;
        for (const c of sortedCloses) { if (c.ts < o.ts) last = c; else break; }
        if (!last) continue;
        if (last.pnl < 0) { sl += o.usd; nl++; } else { sw += o.usd; nw++; }
    }
    const afterLoss = nl ? sl / nl : 0, afterWin = nw ? sw / nw : 0;
    const ratio = afterWin > 0 ? afterLoss / afterWin : (afterLoss > 0 ? Infinity : 1);
    return { afterLoss, afterWin, ratio, tilted: nl >= 3 && nw >= 3 && ratio > 1.3, n: nl + nw };
}

/** Annualized return of an edge locked until `endTs`: (edge/price) / (days/365). */
export function annualizedReturn(edge: number, price: number, endTs: number, at = now()): number {
    const days = Math.max(1 / 24, (endTs - at) / 86_400);
    return (edge / price) / (days / 365);
}
