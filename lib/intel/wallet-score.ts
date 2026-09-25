/**
 * Wallet scoring (Phase 2, spec §2 + §13.1–7).
 *
 * Everything here is computed from the local `trades` + `markets` tables (lib/pm/db.ts).
 * Only RESOLVED markets (markets.resolved = 1, winner_index set) count toward skill metrics.
 * Up/down crypto scalps are excluded. Hedged positions (both sides of one market) are excluded
 * from directional scoring.
 *
 * Calibrated ROI (the headline skill number)
 * ------------------------------------------
 *   calibrated_roi = Σ pnl_i / Σ ( stake_i · sqrt((1 − p_i) / p_i) )
 * where p_i is the average entry price of position i and stake_i its cost basis.
 * sqrt((1−p)/p) is the standard deviation of the per-dollar payoff under the null that the
 * market price is right (win pays (1−p)/p, loss pays −1). So the denominator is the total
 * price-implied risk taken, and the number reads as "P/L per unit of risk":
 *   95¢ favourite win : +0.053·s / (0.229·s) = +0.23     95¢ favourite loss : −s / 0.229·s = −4.4
 *   20¢ longshot  win : +4·s     / (2.0·s)   = +2.0      20¢ longshot  loss : −s / 2.0·s   = −0.5
 * Grinding favourites therefore proves little, hitting longshots proves a lot, and one blown
 * favourite wipes out ~19 favourite wins, exactly as the odds imply.
 *
 * p_value: one-sided test that wins exceed the sum of entry-price-implied probabilities,
 * normal approximation of the Poisson-binomial (mean Σp_i, var Σp_i(1−p_i)).
 */
import { openDb, all, get, run, stmt, transaction, now } from '../pm/db';
import { ALL_CATEGORIES, Category } from '../pm/categories';

export interface TradeRow { id: string; wallet: string; condition_id: string; outcome_index: number; side: 'BUY' | 'SELL'; size: number; price: number; usdc: number; ts: number; event_slug: string | null; category: string | null; resolved: number | null; winner_index: number | null; end_ts: number | null; question: string | null }

export interface Position {
    wallet: string;
    conditionId: string;
    outcomeIndex: number;
    category: string;
    eventSlug: string;
    question: string;
    buys: { ts: number; size: number; price: number }[];
    sells: { ts: number; size: number; price: number }[];
    buyShares: number;
    buyCost: number;          // stake
    sellShares: number;       // capped at buyShares (sells of shares bought before our history are ignored)
    sellProceeds: number;
    avgEntry: number;
    firstTs: number;
    lastTs: number;
    resolved: boolean;
    won: boolean | null;
    endTs: number | null;
    pnl: number | null;       // realized + settled, only when resolved
    hedged: boolean;
}

const SCALP_RE = /updown|up-or-down/i;

export function ensureSchema() { openDb(); }

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
export function erf(x: number): number {
    // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
    const sign = x < 0 ? -1 : 1; const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return sign * y;
}
export function normalCdf(z: number): number { return 0.5 * (1 + erf(z / Math.SQRT2)); }

export function median(xs: number[]): number {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------------------
// Position building
// ---------------------------------------------------------------------------
export function loadTrades(wallet?: string, sinceTs = 0): TradeRow[] {
    openDb();
    const sql = `SELECT t.id, t.wallet, t.condition_id, t.outcome_index, t.side, t.size, t.price, t.usdc, t.ts, COALESCE(t.event_slug, m.event_slug) AS event_slug,
                        m.category, m.resolved, m.winner_index, m.end_ts, COALESCE(m.question, t.title) AS question
                 FROM trades t LEFT JOIN markets m ON m.condition_id = t.condition_id
                 WHERE t.ts >= ? ${wallet ? 'AND t.wallet = ?' : ''} ORDER BY t.ts ASC`;
    return (wallet ? all<TradeRow>(sql, sinceTs, wallet.toLowerCase()) : all<TradeRow>(sql, sinceTs));
}

export function buildPositions(trades: TradeRow[]): Position[] {
    const map: Record<string, Position> = {};
    for (const t of trades) {
        if (SCALP_RE.test(t.event_slug || '')) continue;
        const key = `${t.wallet}|${t.condition_id}|${t.outcome_index}`;
        let p = map[key];
        if (!p) {
            p = map[key] = {
                wallet: t.wallet, conditionId: t.condition_id, outcomeIndex: t.outcome_index, category: t.category || 'other', eventSlug: t.event_slug || '', question: t.question || '',
                buys: [], sells: [], buyShares: 0, buyCost: 0, sellShares: 0, sellProceeds: 0, avgEntry: 0, firstTs: t.ts, lastTs: t.ts,
                resolved: Boolean(t.resolved) && t.winner_index !== null, won: null, endTs: t.end_ts, pnl: null, hedged: false
            };
            if (p.resolved) p.won = t.winner_index === t.outcome_index;
        }
        if (t.side === 'BUY') { p.buys.push({ ts: t.ts, size: t.size, price: t.price }); p.buyShares += t.size; p.buyCost += t.usdc; }
        else p.sells.push({ ts: t.ts, size: t.size, price: t.price });
        p.firstTs = Math.min(p.firstTs, t.ts); p.lastTs = Math.max(p.lastTs, t.ts);
    }
    const positions = Object.keys(map).map(k => map[k]);
    for (const p of positions) {
        // Cap sells at shares we saw bought: proceeds beyond that come from history we do not have.
        let remaining = p.buyShares;
        for (const s of p.sells) { const take = Math.min(remaining, s.size); p.sellShares += take; p.sellProceeds += take * s.price; remaining -= take; if (remaining <= 0) break; }
        p.avgEntry = p.buyShares > 0 ? p.buyCost / p.buyShares : 0;
        if (p.resolved && p.buyShares > 0) {
            const held = Math.max(0, p.buyShares - p.sellShares);
            p.pnl = p.sellProceeds + (p.won ? held : 0) - p.buyCost;
        }
    }
    // Hedge detection: both outcome indices of one condition held at the same time. A position is held from
    // its first buy until it is fully sold (last sell when sells >= buys) or, if never fully sold, until resolution.
    const holdEnd = (p: Position) => (p.sellShares >= p.buyShares - 1e-6 && p.sells.length ? Math.max.apply(null, p.sells.map(s => s.ts)) : Infinity);
    const byCond: Record<string, Position[]> = {};
    for (const p of positions) { const k = `${p.wallet}|${p.conditionId}`; (byCond[k] = byCond[k] || []).push(p); }
    for (const k of Object.keys(byCond)) {
        const ps = byCond[k].filter(p => p.buyShares > 0);
        if (ps.length < 2) continue;
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
            const a = ps[i], b = ps[j];
            if (a.firstTs <= holdEnd(b) && b.firstTs <= holdEnd(a)) { a.hedged = true; b.hedged = true; }
        }
    }
    return positions;
}

/** Directional, resolved, non-hedged positions with a stake. */
export function scorable(positions: Position[]): Position[] {
    return positions.filter(p => p.resolved && !p.hedged && p.buyShares > 0 && p.pnl !== null && p.avgEntry > 0 && p.avgEntry < 1);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
export interface Metrics {
    n_markets: number; n_resolved: number; wins: number; staked: number; pnl: number; roi: number | null;
    calibrated_roi: number | null; brier: number | null; avg_entry_price: number | null;
    longshot_share: number | null; favorite_share: number | null; p_value: number | null; z: number | null;
    entry_timing: number | null;
}

export function computeMetrics(allPositions: Position[], resolvedOnly: Position[], entryTiming?: (p: Position) => number | null): Metrics {
    const n_markets = allPositions.filter(p => p.buyShares > 0).length;
    const ps = resolvedOnly;
    if (!ps.length) return { n_markets, n_resolved: 0, wins: 0, staked: 0, pnl: 0, roi: null, calibrated_roi: null, brier: null, avg_entry_price: null, longshot_share: null, favorite_share: null, p_value: null, z: null, entry_timing: null };
    let wins = 0, staked = 0, pnl = 0, risk = 0, brier = 0, sumP = 0, varP = 0, entrySum = 0, longshot = 0, fav = 0;
    const timings: number[] = [];
    for (const p of ps) {
        const q = p.avgEntry;
        if (p.won) wins++;
        staked += p.buyCost; pnl += p.pnl!;
        risk += p.buyCost * Math.sqrt((1 - q) / q);
        brier += (q - (p.won ? 1 : 0)) ** 2;
        sumP += q; varP += q * (1 - q); entrySum += q;
        if (q <= 0.30) longshot++; if (q >= 0.70) fav++;
        if (entryTiming) { const t = entryTiming(p); if (t !== null && Number.isFinite(t)) timings.push(t); }
    }
    const z = varP > 0 ? (wins - sumP) / Math.sqrt(varP) : null;
    return {
        n_markets, n_resolved: ps.length, wins, staked, pnl,
        roi: staked > 0 ? pnl / staked : null,
        calibrated_roi: risk > 0 ? pnl / risk : null,
        brier: brier / ps.length,
        avg_entry_price: entrySum / ps.length,
        longshot_share: longshot / ps.length, favorite_share: fav / ps.length,
        p_value: z === null ? null : 1 - normalCdf(z), z,
        entry_timing: timings.length ? timings.reduce((a, b) => a + b, 0) / timings.length : null
    };
}

/**
 * Entry timing: favourable price move (in probability points, + = moved the wallet's way) between the
 * first buy and ~24h later. Sources in order: `prices` table for the market's token (if ingested),
 * else the wallet's own later trade in the same market/outcome within 24h. Positions with neither
 * are excluded (returns null) — resolution prices are NOT used because they only restate the outcome.
 */
export function entryTimingFor(p: Position, priceLookup?: (conditionId: string, outcomeIndex: number, ts: number) => number | null): number | null {
    if (!p.buys.length) return null;
    const entry = p.buys[0];
    const later = priceLookup ? priceLookup(p.conditionId, p.outcomeIndex, entry.ts + 86_400) : null;
    if (later !== null && later !== undefined) return later - entry.price;
    const own = p.buys.concat(p.sells).filter(t => t.ts > entry.ts && t.ts <= entry.ts + 86_400).sort((a, b) => b.ts - a.ts)[0];
    return own ? own.price - entry.price : null;
}

const tokenCache: Record<string, string[]> = {};
export function makePriceLookup(): (conditionId: string, outcomeIndex: number, ts: number) => number | null {
    openDb();
    const has = get<{ n: number }>('SELECT COUNT(*) n FROM prices')?.n ?? 0;
    if (!has) return () => null;
    return (cid, oi, ts) => {
        if (!tokenCache[cid]) { const r = get<{ clob_token_ids: string }>('SELECT clob_token_ids FROM markets WHERE condition_id = ?', cid); try { tokenCache[cid] = JSON.parse(r?.clob_token_ids || '[]'); } catch { tokenCache[cid] = []; } }
        const tok = tokenCache[cid][oi]; if (!tok) return null;
        const row = get<{ price: number }>('SELECT price FROM prices WHERE token_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1', tok, ts);
        return row ? row.price : null;
    };
}

export const WINDOWS = [0, 30, 90];

export interface ScoreRow extends Metrics { wallet: string; category: string; window_days: number; conviction_sigma: number | null; computed_at: number }

export function scoreWallet(wallet: string, opts: { priceLookup?: ReturnType<typeof makePriceLookup>; persist?: boolean } = {}): ScoreRow[] {
    openDb();
    const trades = loadTrades(wallet);
    const positions = buildPositions(trades);
    const lookup = opts.priceLookup ?? makePriceLookup();
    const timing = (p: Position) => entryTimingFor(p, lookup);
    const rows: ScoreRow[] = [];
    const t = now();
    const sizes = trades.filter(x => x.side === 'BUY').slice(-200).map(x => x.usdc);
    const mean = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
    const sd = sizes.length > 1 ? Math.sqrt(sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / (sizes.length - 1)) : 0;
    const cats: string[] = ['all'].concat(ALL_CATEGORIES);
    for (const cat of cats) {
        for (const w of WINDOWS) {
            const since = w ? t - w * 86_400 : 0;
            const ps = positions.filter(p => (cat === 'all' || p.category === cat) && p.firstTs >= since);
            const m = computeMetrics(ps, scorable(ps), timing);
            if (m.n_markets === 0) continue;
            rows.push({ wallet: wallet.toLowerCase(), category: cat, window_days: w, conviction_sigma: sd > 0 ? sd / mean : null, computed_at: t, ...m });
        }
    }
    if (opts.persist !== false) persistScores(rows);
    return rows;
}

export function persistScores(rows: ScoreRow[]) {
    transaction(() => {
        const ins = stmt(`INSERT OR REPLACE INTO wallet_scores(wallet, category, window_days, n_markets, n_resolved, wins, staked, pnl, roi, calibrated_roi, brier, avg_entry_price, longshot_share, favorite_share, p_value, entry_timing, conviction_sigma, computed_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        for (const r of rows) ins.run(r.wallet, r.category, r.window_days, r.n_markets, r.n_resolved, r.wins, r.staked, r.pnl, r.roi, r.calibrated_roi, r.brier, r.avg_entry_price, r.longshot_share, r.favorite_share, r.p_value, r.entry_timing, r.conviction_sigma, r.computed_at);
    });
}

export function scoreAllWallets(log: (m: string) => void = () => {}): number {
    openDb();
    const wallets = all<{ wallet: string }>('SELECT DISTINCT wallet FROM trades');
    const lookup = makePriceLookup();
    let n = 0;
    for (const w of wallets) { scoreWallet(w.wallet, { priceLookup: lookup }); n++; if (n % 25 === 0) log(`scored ${n}/${wallets.length}`); }
    log(`scored ${n} wallets`);
    return n;
}

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------
export type EdgeTrend = 'improving' | 'fading' | 'stable' | 'insufficient';

export function edgeTrend(wallet: string, category = 'all'): { trend: EdgeTrend; roi30: number | null; roi90: number | null; roiAll: number | null; cal30: number | null; cal90: number | null; calAll: number | null } {
    openDb();
    const r = (w: number) => get<{ roi: number | null; calibrated_roi: number | null; n_resolved: number }>('SELECT roi, calibrated_roi, n_resolved FROM wallet_scores WHERE wallet = ? AND category = ? AND window_days = ?', wallet.toLowerCase(), category, w);
    const a = r(0), b = r(90), c = r(30);
    const out = { trend: 'insufficient' as EdgeTrend, roi30: c?.roi ?? null, roi90: b?.roi ?? null, roiAll: a?.roi ?? null, cal30: c?.calibrated_roi ?? null, cal90: b?.calibrated_roi ?? null, calAll: a?.calibrated_roi ?? null };
    if (!a || !c || (c.n_resolved ?? 0) < 10 || (a.n_resolved ?? 0) < 30 || c.calibrated_roi === null || a.calibrated_roi === null) return out;
    const d = c.calibrated_roi - a.calibrated_roi;
    out.trend = d > 0.1 ? 'improving' : d < -0.1 ? 'fading' : 'stable';
    return out;
}

/** How unusual a trade size is for this wallet: ratio to median of last 200 buys, and z-score vs their mean/sd. */
export function convictionSigma(wallet: string, usdc: number): { ratio: number | null; z: number | null; median: number; n: number } {
    openDb();
    const sizes = all<{ usdc: number }>('SELECT usdc FROM trades WHERE wallet = ? AND side = ? ORDER BY ts DESC LIMIT 200', wallet.toLowerCase(), 'BUY').map(r => r.usdc);
    if (sizes.length < 5) return { ratio: null, z: null, median: median(sizes), n: sizes.length };
    const med = median(sizes);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const sd = Math.sqrt(sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / (sizes.length - 1));
    return { ratio: med > 0 ? usdc / med : null, z: sd > 0 ? (usdc - mean) / sd : null, median: med, n: sizes.length };
}

export interface LifecycleStep { ts: number; action: 'entry' | 'add' | 'trim' | 'exit'; size: number; price: number; netAfter: number }

export function positionLifecycle(wallet: string, conditionId: string, outcomeIndex: number): LifecycleStep[] {
    openDb();
    const rows = all<{ ts: number; side: string; size: number; price: number }>('SELECT ts, side, size, price FROM trades WHERE wallet = ? AND condition_id = ? AND outcome_index = ? ORDER BY ts ASC', wallet.toLowerCase(), conditionId.toLowerCase(), outcomeIndex);
    const steps: LifecycleStep[] = []; let net = 0;
    for (const r of rows) {
        if (r.side === 'BUY') { steps.push({ ts: r.ts, action: net <= 1e-9 ? 'entry' : 'add', size: r.size, price: r.price, netAfter: net + r.size }); net += r.size; }
        else { const after = Math.max(0, net - r.size); steps.push({ ts: r.ts, action: after <= 1e-6 ? 'exit' : 'trim', size: r.size, price: r.price, netAfter: after }); net = after; }
    }
    return steps;
}

export interface TopWalletsOpts { category?: string; window?: number; minResolved?: number; maxP?: number; minCalibratedRoi?: number; limit?: number; worst?: boolean }

export function topWallets(o: TopWalletsOpts = {}): (ScoreRow & { username: string | null })[] {
    openDb();
    const { category = 'all', window = 0, minResolved = 30, maxP = 1, minCalibratedRoi = -Infinity, limit = 25, worst = false } = o;
    return all<ScoreRow & { username: string | null }>(
        `SELECT s.*, w.username FROM wallet_scores s LEFT JOIN wallets w ON w.address = s.wallet
         WHERE s.category = ? AND s.window_days = ? AND s.n_resolved >= ? AND s.p_value IS NOT NULL AND (? = 1 OR s.p_value <= ?) AND s.calibrated_roi >= ?
         ORDER BY s.calibrated_roi ${worst ? 'ASC' : 'DESC'} LIMIT ?`,
        category, window, minResolved, maxP >= 1 ? 1 : 0, maxP, Number.isFinite(minCalibratedRoi) ? minCalibratedRoi : -1e9, limit);
}

export function walletReport(address: string) {
    openDb();
    const wallet = address.toLowerCase();
    const scores = all<ScoreRow>('SELECT * FROM wallet_scores WHERE wallet = ? ORDER BY category, window_days', wallet);
    const info = get<Record<string, unknown>>('SELECT * FROM wallets WHERE address = ?', wallet);
    const positions = buildPositions(loadTrades(wallet));
    const open = positions.filter(p => !p.resolved && p.buyShares - p.sellShares > 1e-6 && !p.hedged);
    return { wallet, info, scores, trend: edgeTrend(wallet), openPositions: open.length, hedgedPositions: positions.filter(p => p.hedged).length, resolvedPositions: scorable(positions).length };
}

// ---------------------------------------------------------------------------
// Consensus + divergence
// ---------------------------------------------------------------------------
export interface SmartWalletCriteria { minCalibratedRoi?: number; minResolved?: number; maxP?: number; category?: string }

export function smartWallets(c: SmartWalletCriteria = {}): string[] {
    return topWallets({ category: c.category ?? 'all', window: 0, minResolved: c.minResolved ?? 30, maxP: c.maxP ?? 0.1, minCalibratedRoi: c.minCalibratedRoi ?? 0.1, limit: 500 }).map(r => r.wallet);
}

export interface ConsensusRow { condition_id: string; outcome_index: number; question: string; wallets: string[]; usdc: number; ts: number }

/** Markets where ≥ minWallets smart wallets bought the same side inside the window. Writes 'consensus' signals. */
export function consensus(opts: { windowHours?: number; minWallets?: number; criteria?: SmartWalletCriteria; persist?: boolean } = {}): ConsensusRow[] {
    openDb();
    const smart = smartWallets(opts.criteria);
    if (!smart.length) return [];
    const since = now() - (opts.windowHours ?? 48) * 3600;
    const rows = all<{ condition_id: string; outcome_index: number; wallet: string; usdc: number; ts: number; question: string }>(
        `SELECT t.condition_id, t.outcome_index, t.wallet, SUM(t.usdc) usdc, MAX(t.ts) ts, COALESCE(m.question, t.title) question
         FROM trades t LEFT JOIN markets m ON m.condition_id = t.condition_id
         WHERE t.side = 'BUY' AND t.ts >= ? AND t.wallet IN (${smart.map(() => '?').join(',')}) AND (m.resolved IS NULL OR m.resolved = 0)
         GROUP BY t.condition_id, t.outcome_index, t.wallet`, since, ...smart);
    const grp: Record<string, ConsensusRow> = {};
    for (const r of rows) {
        const k = `${r.condition_id}|${r.outcome_index}`;
        const g = grp[k] || (grp[k] = { condition_id: r.condition_id, outcome_index: r.outcome_index, question: r.question, wallets: [], usdc: 0, ts: 0 });
        g.wallets.push(r.wallet); g.usdc += r.usdc; g.ts = Math.max(g.ts, r.ts);
    }
    const out = Object.keys(grp).map(k => grp[k]).filter(g => g.wallets.length >= (opts.minWallets ?? 2)).sort((a, b) => b.wallets.length - a.wallets.length || b.usdc - a.usdc);
    if (opts.persist !== false) transaction(() => { for (const g of out) { if (!get('SELECT 1 FROM signals WHERE type = ? AND condition_id = ? AND outcome_index = ? AND ts = ?', 'consensus', g.condition_id, g.outcome_index, g.ts)) run('INSERT INTO signals(type, ts, condition_id, outcome_index, score, payload) VALUES (?,?,?,?,?,?)', 'consensus', g.ts, g.condition_id, g.outcome_index, Math.min(100, g.wallets.length * 25), JSON.stringify({ question: g.question, wallets: g.wallets, usdc: g.usdc })); } });
    return out;
}

export interface DivergenceRow { condition_id: string; outcome_index: number; question: string; smart_usdc: number; smart_wallets: number; crowd_usdc_same: number; crowd_usdc_other: number; crowd_share_other: number }

/** Smart money net-buying one side while total BUY volume (all wallets in `trades`) leans the other way. */
export function divergence(opts: { windowHours?: number; criteria?: SmartWalletCriteria; minCrowdShareOther?: number; persist?: boolean } = {}): DivergenceRow[] {
    openDb();
    const smart = smartWallets(opts.criteria);
    if (!smart.length) return [];
    const since = now() - (opts.windowHours ?? 48) * 3600;
    const ph = smart.map(() => '?').join(',');
    const smartRows = all<{ condition_id: string; outcome_index: number; usdc: number; n: number; question: string }>(
        `SELECT t.condition_id, t.outcome_index, SUM(t.usdc) usdc, COUNT(DISTINCT t.wallet) n, COALESCE(m.question, t.title) question
         FROM trades t LEFT JOIN markets m ON m.condition_id = t.condition_id
         WHERE t.side = 'BUY' AND t.ts >= ? AND t.wallet IN (${ph}) AND (m.resolved IS NULL OR m.resolved = 0) GROUP BY t.condition_id, t.outcome_index`, since, ...smart);
    const out: DivergenceRow[] = [];
    for (const s of smartRows) {
        const crowd = all<{ outcome_index: number; usdc: number }>(`SELECT outcome_index, SUM(usdc) usdc FROM trades WHERE condition_id = ? AND side = 'BUY' AND ts >= ? AND wallet NOT IN (${ph}) GROUP BY outcome_index`, s.condition_id, since, ...smart);
        const same = crowd.filter(c => c.outcome_index === s.outcome_index).reduce((a, c) => a + c.usdc, 0);
        const other = crowd.filter(c => c.outcome_index !== s.outcome_index).reduce((a, c) => a + c.usdc, 0);
        const total = same + other;
        if (total <= 0) continue;
        const shareOther = other / total;
        if (shareOther >= (opts.minCrowdShareOther ?? 0.6)) out.push({ condition_id: s.condition_id, outcome_index: s.outcome_index, question: s.question, smart_usdc: s.usdc, smart_wallets: s.n, crowd_usdc_same: same, crowd_usdc_other: other, crowd_share_other: shareOther });
    }
    out.sort((a, b) => b.crowd_share_other - a.crowd_share_other);
    if (opts.persist !== false) transaction(() => { const t = now(); for (const d of out) { if (!get('SELECT 1 FROM signals WHERE type = ? AND condition_id = ? AND outcome_index = ? AND ts > ?', 'divergence', d.condition_id, d.outcome_index, t - 6 * 3600)) run('INSERT INTO signals(type, ts, condition_id, outcome_index, score, payload) VALUES (?,?,?,?,?,?)', 'divergence', t, d.condition_id, d.outcome_index, Math.round(d.crowd_share_other * 100), JSON.stringify(d)); } });
    return out;
}
