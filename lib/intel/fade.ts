/**
 * Loser tracking + fade strategies (Phase 2, spec §3 + §13.8–11).
 *
 * "Bad" is not "lost money": it is wins BELOW what entry prices implied, with significance.
 *   loss-side p = Φ(z) where z = (wins − Σp_i) / sqrt(Σp_i(1−p_i))   (wallet-score stores 1−Φ(z) as p_value)
 * A wallet is fadeable when calibrated_roi < 0, n_resolved ≥ minResolved and Φ(z) ≤ maxLossP.
 */
import { openDb, all, get, run, stmt, transaction, now } from '../pm/db';
import { loadTrades, buildPositions, scorable, normalCdf, Position, makePriceLookup } from './wallet-score';

export function ensureSchema() {
    openDb();
    stmt(`CREATE TABLE IF NOT EXISTS wallet_bias (
        wallet TEXT PRIMARY KEY,
        n_resolved INTEGER,
        longshot_share REAL, longshot_roi REAL,
        chaser_score REAL, chaser_n INTEGER,
        tilt_ratio REAL,
        top_category TEXT, top_category_share REAL,
        top_event TEXT, top_event_share REAL,
        one_sided_share REAL, one_sided_index INTEGER,
        tags TEXT,
        computed_at INTEGER)`).run();
}

export interface AntiRow { wallet: string; username: string | null; category: string; n_resolved: number; wins: number; staked: number; pnl: number; roi: number; calibrated_roi: number; loss_p: number; avg_entry_price: number; longshot_share: number }

/** Worst wallets by calibrated ROI, only where the shortfall is statistically unlikely to be luck. */
export function antiLeaderboard(o: { category?: string; window?: number; minResolved?: number; maxLossP?: number; limit?: number } = {}): AntiRow[] {
    ensureSchema();
    const { category = 'all', window = 0, minResolved = 50, maxLossP = 0.1, limit = 25 } = o;
    return all<AntiRow>(
        `SELECT s.wallet, w.username, s.category, s.n_resolved, s.wins, s.staked, s.pnl, s.roi, s.calibrated_roi, (1 - s.p_value) AS loss_p, s.avg_entry_price, s.longshot_share
         FROM wallet_scores s LEFT JOIN wallets w ON w.address = s.wallet
         WHERE s.category = ? AND s.window_days = ? AND s.n_resolved >= ? AND s.calibrated_roi < 0 AND s.p_value IS NOT NULL AND (1 - s.p_value) <= ?
         ORDER BY s.calibrated_roi ASC LIMIT ?`, category, window, minResolved, maxLossP, limit);
}

export interface BiasFingerprint {
    wallet: string; n_resolved: number;
    longshot_share: number; longshot_roi: number | null;
    /** mean(entry − price 1h earlier) over buys with a reference; > 0 means buys after the price already rose (chaser). */
    chaser_score: number | null; chaser_n: number;
    /** avg stake after a resolved loss / avg stake after a resolved win; > 1.3 = tilt. */
    tilt_ratio: number | null;
    top_category: string; top_category_share: number;
    top_event: string; top_event_share: number;
    /** share of stake on the most-used outcome index (1.0 = always the same side). */
    one_sided_share: number; one_sided_index: number;
    tags: string[];
}

/**
 * Chaser reference price: `prices` table (token price 1h before the buy) when ingested, otherwise the
 * wallet's own most recent trade in the same market/outcome within the prior 24h. Buys with neither
 * are skipped, so chaser_n tells you how much evidence there is.
 */
export function biasFingerprint(wallet: string, opts: { persist?: boolean; positions?: Position[] } = {}): BiasFingerprint {
    ensureSchema();
    const w = wallet.toLowerCase();
    const positions = opts.positions ?? buildPositions(loadTrades(w));
    const res = scorable(positions);
    const lookup = makePriceLookup();
    // longshots
    const ls = res.filter(p => p.avgEntry <= 0.15);
    const lsStake = ls.reduce((a, p) => a + p.buyCost, 0);
    const longshot_roi = lsStake > 0 ? ls.reduce((a, p) => a + (p.pnl || 0), 0) / lsStake : null;
    // chaser
    let chaseSum = 0, chaseN = 0;
    for (const p of positions) {
        const buys = p.buys.slice().sort((a, b) => a.ts - b.ts);
        const own = p.buys.concat(p.sells).sort((a, b) => a.ts - b.ts);
        for (const b of buys) {
            let ref = lookup(p.conditionId, p.outcomeIndex, b.ts - 3600);
            if (ref === null) { const prev = own.filter(t => t.ts < b.ts && t.ts >= b.ts - 86_400).pop(); ref = prev ? prev.price : null; }
            if (ref === null) continue;
            chaseSum += b.price - ref; chaseN++;
        }
    }
    // tilt: stake of a position vs. outcome of the most recently resolved earlier position
    const byEnd = res.filter(p => p.endTs).slice().sort((a, b) => (a.endTs! - b.endTs!));
    let afterLoss: number[] = [], afterWin: number[] = [];
    for (const p of positions.filter(x => x.buyShares > 0)) {
        let last: Position | null = null;
        for (const r of byEnd) { if (r.endTs! < p.firstTs) last = r; else break; }
        if (!last) continue;
        (last.won ? afterWin : afterLoss).push(p.buyCost);
    }
    const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const aL = avg(afterLoss), aW = avg(afterWin);
    const tilt_ratio = aL !== null && aW !== null && aW > 0 ? aL / aW : null;
    // concentration
    const staked = positions.filter(p => p.buyShares > 0);
    const total = staked.reduce((a, p) => a + p.buyCost, 0) || 1;
    const byCat: Record<string, number> = {}, byEv: Record<string, number> = {}, byIdx: Record<number, number> = {};
    for (const p of staked) { byCat[p.category] = (byCat[p.category] || 0) + p.buyCost; byEv[p.eventSlug] = (byEv[p.eventSlug] || 0) + p.buyCost; byIdx[p.outcomeIndex] = (byIdx[p.outcomeIndex] || 0) + p.buyCost; }
    const top = (m: Record<string, number>) => Object.keys(m).sort((a, b) => m[b] - m[a])[0] || '';
    const tc = top(byCat), te = top(byEv);
    const idxKeys = Object.keys(byIdx).map(Number); const ti = idxKeys.sort((a, b) => byIdx[b] - byIdx[a])[0] ?? 0;
    const fp: BiasFingerprint = {
        wallet: w, n_resolved: res.length,
        longshot_share: res.length ? ls.length / res.length : 0, longshot_roi,
        chaser_score: chaseN ? chaseSum / chaseN : null, chaser_n: chaseN,
        tilt_ratio,
        top_category: tc, top_category_share: (byCat[tc] || 0) / total,
        top_event: te, top_event_share: (byEv[te] || 0) / total,
        one_sided_share: (byIdx[ti] || 0) / total, one_sided_index: ti,
        tags: []
    };
    if (fp.longshot_share >= 0.4 && (fp.longshot_roi ?? 0) < 0) fp.tags.push('longshot_buyer');
    if ((fp.chaser_score ?? 0) >= 0.03 && fp.chaser_n >= 20) fp.tags.push('chaser');
    if ((fp.tilt_ratio ?? 0) >= 1.3 && afterLoss.length >= 10) fp.tags.push('tilt');
    if (fp.top_event_share >= 0.5 && staked.length >= 10) fp.tags.push('fan_money');
    if (fp.top_category_share >= 0.8 && staked.length >= 10) fp.tags.push('partisan_' + tc);
    if (fp.one_sided_share >= 0.85 && staked.length >= 10) fp.tags.push(`one_sided_idx${ti}`);
    if (opts.persist !== false) stmt(`INSERT OR REPLACE INTO wallet_bias(wallet, n_resolved, longshot_share, longshot_roi, chaser_score, chaser_n, tilt_ratio, top_category, top_category_share, top_event, top_event_share, one_sided_share, one_sided_index, tags, computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(fp.wallet, fp.n_resolved, fp.longshot_share, fp.longshot_roi, fp.chaser_score, fp.chaser_n, fp.tilt_ratio, fp.top_category, fp.top_category_share, fp.top_event, fp.top_event_share, fp.one_sided_share, fp.one_sided_index, JSON.stringify(fp.tags), now());
    return fp;
}

export function fingerprintAll(log: (m: string) => void = () => {}): number {
    ensureSchema();
    const ws = all<{ wallet: string }>('SELECT DISTINCT wallet FROM wallet_scores WHERE category = ? AND window_days = 0 AND n_resolved >= 20', 'all');
    for (const w of ws) biasFingerprint(w.wallet);
    log(`fingerprinted ${ws.length} wallets`);
    return ws.length;
}

/**
 * Fade score 0–100 for a new trade by `wallet`:
 *   50 · badness  (−calibrated_roi in the trade's category, else 'all', clipped to [0, 1])
 * + 30 · significance (1 − loss_p)
 * + 20 · distance (|entry − fair| / 0.25, clipped), fair = current mid for that outcome (markets.best_bid/ask or yes_price)
 * Halved when n_resolved < minResolved. Returns 0 when the wallet is not bad (calibrated_roi ≥ 0).
 */
export function fadeScore(t: { wallet: string; condition_id: string; outcome_index: number; price: number }, minResolved = 50): { score: number; badness: number; significance: number; distance: number; fair: number | null; category: string; n_resolved: number } {
    ensureSchema();
    const m = get<{ category: string; best_bid: number | null; best_ask: number | null; yes_price: number | null }>('SELECT category, best_bid, best_ask, yes_price FROM markets WHERE condition_id = ?', t.condition_id.toLowerCase());
    const category = m?.category || 'other';
    let s = get<{ calibrated_roi: number | null; p_value: number | null; n_resolved: number }>('SELECT calibrated_roi, p_value, n_resolved FROM wallet_scores WHERE wallet = ? AND category = ? AND window_days = 0', t.wallet.toLowerCase(), category);
    if (!s || s.n_resolved < 10) s = get('SELECT calibrated_roi, p_value, n_resolved FROM wallet_scores WHERE wallet = ? AND category = ? AND window_days = 0', t.wallet.toLowerCase(), 'all');
    const empty = { score: 0, badness: 0, significance: 0, distance: 0, fair: null, category, n_resolved: s?.n_resolved ?? 0 };
    if (!s || s.calibrated_roi === null || s.calibrated_roi >= 0) return empty;
    const badness = Math.min(1, -s.calibrated_roi);
    const significance = s.p_value === null ? 0 : Math.max(0, Math.min(1, s.p_value)); // p_value is upper-tail → loss_p = 1 − p_value → significance = p_value
    let fairYes: number | null = null;
    if (m) { if (m.best_bid && m.best_ask) fairYes = (m.best_bid + m.best_ask) / 2; else if (m.yes_price !== null) fairYes = m.yes_price; }
    const fair = fairYes === null ? null : (t.outcome_index === 0 ? fairYes : 1 - fairYes);
    const distance = fair === null ? 0 : Math.min(1, Math.max(0, t.price - fair) / 0.25); // only overpaying vs fair counts
    let score = 50 * badness + 30 * significance + 20 * distance;
    if (s.n_resolved < minResolved) score /= 2;
    return { score: Math.round(score), badness, significance, distance, fair, category, n_resolved: s.n_resolved };
}

export function fadeableWallets(o: { minResolved?: number; maxLossP?: number } = {}): string[] {
    return antiLeaderboard({ minResolved: o.minResolved ?? 50, maxLossP: o.maxLossP ?? 0.1, limit: 1000 }).map(r => r.wallet);
}

export interface CrowdOfLosers { condition_id: string; question: string; days: number; sides: { outcome_index: number; total_usdc: number; loser_usdc: number; loser_share: number }[] }

/** Share of BUY volume in the last `days` coming from fadeable wallets, per side. */
export function crowdOfLosers(conditionId: string, days = 7, o: { minResolved?: number; maxLossP?: number } = {}): CrowdOfLosers {
    ensureSchema();
    const losers = fadeableWallets(o);
    const since = now() - days * 86_400;
    const rows = all<{ outcome_index: number; wallet: string; usdc: number }>('SELECT outcome_index, wallet, SUM(usdc) usdc FROM trades WHERE condition_id = ? AND side = ? AND ts >= ? GROUP BY outcome_index, wallet', conditionId.toLowerCase(), 'BUY', since);
    const q = get<{ question: string }>('SELECT question FROM markets WHERE condition_id = ?', conditionId.toLowerCase());
    const set: Record<string, true> = {}; for (const l of losers) set[l] = true;
    const sides: Record<number, { outcome_index: number; total_usdc: number; loser_usdc: number; loser_share: number }> = {};
    for (const r of rows) { const s = sides[r.outcome_index] || (sides[r.outcome_index] = { outcome_index: r.outcome_index, total_usdc: 0, loser_usdc: 0, loser_share: 0 }); s.total_usdc += r.usdc; if (set[r.wallet]) s.loser_usdc += r.usdc; }
    const out = Object.keys(sides).map(k => sides[Number(k)]); for (const s of out) s.loser_share = s.total_usdc ? s.loser_usdc / s.total_usdc : 0;
    return { condition_id: conditionId.toLowerCase(), question: q?.question || '', days, sides: out };
}

export interface FadeBacktestResult { n: number; wins: number; staked: number; pnl: number; roi: number | null; byCategory: Record<string, { n: number; wins: number; staked: number; pnl: number; roi: number | null }>; flaggedWallets: number }

/**
 * Walk-forward fade backtest. For every resolved position, the wallet's badness is judged using ONLY
 * positions that resolved (market end) before that position's entry. If flagged, we take the opposite
 * side at the same time: buy the complement at (1 − p)·(1 + slippage), hold to resolution.
 */
export function fadeBacktest(o: { minResolved?: number; maxLossP?: number; feeBps?: number; slippageBps?: number; wallets?: string[] } = {}): FadeBacktestResult {
    ensureSchema();
    const minResolved = o.minResolved ?? 50, maxLossP = o.maxLossP ?? 0.1, fee = (o.feeBps ?? 0) / 10_000, slip = (o.slippageBps ?? 50) / 10_000;
    const wallets = o.wallets ?? all<{ wallet: string }>('SELECT DISTINCT wallet FROM trades').map(r => r.wallet);
    const res: FadeBacktestResult = { n: 0, wins: 0, staked: 0, pnl: 0, roi: null, byCategory: {}, flaggedWallets: 0 };
    for (const w of wallets) {
        const ps = scorable(buildPositions(loadTrades(w))).filter(p => p.endTs);
        if (ps.length < minResolved + 1) continue;
        const byEntry = ps.slice().sort((a, b) => a.firstTs - b.firstTs);
        const byEnd = ps.slice().sort((a, b) => a.endTs! - b.endTs!);
        let j = 0, n = 0, wins = 0, sumP = 0, varP = 0, pnl = 0, risk = 0, flaggedAny = false;
        for (const p of byEntry) {
            while (j < byEnd.length && byEnd[j].endTs! < p.firstTs) { const r = byEnd[j++]; n++; if (r.won) wins++; sumP += r.avgEntry; varP += r.avgEntry * (1 - r.avgEntry); pnl += r.pnl!; risk += r.buyCost * Math.sqrt((1 - r.avgEntry) / r.avgEntry); }
            if (n < minResolved || risk <= 0 || varP <= 0) continue;
            const cal = pnl / risk, lossP = normalCdf((wins - sumP) / Math.sqrt(varP));
            if (!(cal < 0 && lossP <= maxLossP)) continue;
            flaggedAny = true;
            const fadePrice = Math.min(0.999, (1 - p.avgEntry) * (1 + slip));
            const stake = p.buyCost;
            const win = !p.won;
            const gross = win ? stake * (1 / fadePrice - 1) : -stake;
            const net = gross - stake * fee;
            res.n++; res.staked += stake; res.pnl += net; if (win) res.wins++;
            const c = res.byCategory[p.category] || (res.byCategory[p.category] = { n: 0, wins: 0, staked: 0, pnl: 0, roi: null });
            c.n++; c.staked += stake; c.pnl += net; if (win) c.wins++;
        }
        if (flaggedAny) res.flaggedWallets++;
    }
    res.roi = res.staked ? res.pnl / res.staked : null;
    for (const k of Object.keys(res.byCategory)) { const c = res.byCategory[k]; c.roi = c.staked ? c.pnl / c.staked : null; }
    return res;
}

/** Emit 'fade' signals for recent buys by fadeable wallets. */
export function emitFadeSignals(hours = 24, o: { minResolved?: number; maxLossP?: number; minScore?: number } = {}): number {
    ensureSchema();
    const losers = fadeableWallets(o);
    if (!losers.length) return 0;
    const since = now() - hours * 3600;
    const rows = all<{ id: string; wallet: string; condition_id: string; outcome_index: number; price: number; usdc: number; ts: number; title: string }>(
        `SELECT id, wallet, condition_id, outcome_index, price, usdc, ts, title FROM trades WHERE side = 'BUY' AND ts >= ? AND wallet IN (${losers.map(() => '?').join(',')}) ORDER BY ts DESC`, since, ...losers);
    let n = 0;
    transaction(() => {
        for (const r of rows) {
            if (get('SELECT 1 FROM signals WHERE type = ? AND wallet = ? AND condition_id = ? AND outcome_index = ? AND ts = ?', 'fade', r.wallet, r.condition_id, r.outcome_index, r.ts)) continue;
            const f = fadeScore(r, o.minResolved ?? 50);
            if (f.score < (o.minScore ?? 40)) continue;
            // The fade signal's own outcome_index is the OPPOSITE side for binary markets (so resolution scoring works).
            run('INSERT INTO signals(type, ts, wallet, condition_id, outcome_index, score, payload) VALUES (?,?,?,?,?,?,?)', 'fade', r.ts, r.wallet, r.condition_id, r.outcome_index === 0 ? 1 : 0, f.score,
                JSON.stringify({ faded_wallet: r.wallet, faded_outcome_index: r.outcome_index, their_price: r.price, their_usdc: r.usdc, title: r.title, ...f }));
            n++;
        }
    });
    return n;
}
