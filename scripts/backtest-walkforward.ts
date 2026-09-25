/**
 * Walk-forward backtest of the product thesis: score wallets ONLY on trades/resolutions known before a cutoff,
 * pick "sharp" (and "fade") wallets by calibrated ROI + significance, then measure the copy ROI of the BUYs they
 * placed AFTER the cutoff, held to resolution. Control = every other wallet with history. No lookahead:
 * in-sample resolutions require market end_ts < cutoff.
 * Usage: npx tsx scripts/backtest-walkforward.ts [cutoffDaysAgo=7] [minResolved=30] [slippageBps=50]
 */
import { config } from 'dotenv'; config({ path: '.env.local', quiet: true });
import { openDb, all, get, kvSet, now } from '../lib/pm/db';
openDb();
const daysAgo = Number(process.argv[2] || 7), minN = Number(process.argv[3] || 30), slip = Number(process.argv[4] || 50) / 10_000;
const T = now() - daysAgo * 86400;
type Trade = { wallet: string; condition_id: string; outcome_index: number; side: string; size: number; price: number; ts: number; event_slug: string };
const trades = all<Trade>(`SELECT wallet, condition_id, outcome_index, side, size, price, ts, event_slug FROM trades WHERE event_slug NOT LIKE '%updown%' ORDER BY ts`);
const mk = new Map(all<{ condition_id: string; resolved: number; winner_index: number; end_ts: number; category: string }>('SELECT condition_id, resolved, winner_index, end_ts, category FROM markets WHERE resolved = 1').map(m => [m.condition_id, m]));
function erf(x: number) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
type Agg = { n: number; wins: number; staked: number; pnl: number; risk: number; sumP: number; sumVar: number; eqPnl: number };
const agg = (): Agg => ({ n: 0, wins: 0, staked: 0, pnl: 0, risk: 0, sumP: 0, sumVar: 0, eqPnl: 0 });
function positions(ts: Trade[]) {
    const pos = new Map<string, { buyShares: number; buyCost: number; sellShares: number; sellProceeds: number; cid: string; oi: number; wallet: string; firstTs: number }>();
    const sides = new Map<string, Set<number>>();
    for (const t of ts) {
        const k = `${t.wallet}|${t.condition_id}|${t.outcome_index}`; const p = pos.get(k) ?? { buyShares: 0, buyCost: 0, sellShares: 0, sellProceeds: 0, cid: t.condition_id, oi: t.outcome_index, wallet: t.wallet, firstTs: t.ts };
        if (t.side === 'BUY') { p.buyShares += t.size; p.buyCost += t.size * t.price; } else { p.sellShares += t.size; p.sellProceeds += t.size * t.price; }
        pos.set(k, p); const sk = `${t.wallet}|${t.condition_id}`; if (!sides.has(sk)) sides.set(sk, new Set()); sides.get(sk)!.add(t.outcome_index);
    }
    return Array.from(pos.values()).filter(p => p.buyShares > 0 && (sides.get(`${p.wallet}|${p.cid}`)?.size ?? 0) === 1);
}
function settle(p: ReturnType<typeof positions>[number], a: Agg, copyMode: boolean) {
    const m = mk.get(p.cid); if (!m) return false;
    const avg = p.buyCost / p.buyShares, won = m.winner_index === p.oi;
    if (copyMode) { const cost = p.buyCost * (1 + slip); a.n++; if (won) a.wins++; a.staked += cost; a.pnl += (won ? p.buyShares : 0) - cost; a.eqPnl += (won ? 1 / (avg * (1 + slip)) : 0) - 1; } // eqPnl: $1 per position
    else { const sold = Math.min(p.sellShares, p.buyShares), held = p.buyShares - sold; const realized = p.sellProceeds * (sold / Math.max(p.sellShares, 1e-9)) + (won ? held : 0) - p.buyCost; a.n++; if (won) a.wins++; a.staked += p.buyCost; a.pnl += realized; }
    a.risk += p.buyCost * Math.sqrt((1 - avg) / avg); a.sumP += avg; a.sumVar += avg * (1 - avg);
    return true;
}
// ---- in-sample scoring (before cutoff, markets ended before cutoff)
const inSample = trades.filter(t => t.ts < T);
const byWallet = new Map<string, Agg>();
for (const p of positions(inSample)) { const m = mk.get(p.cid); if (!m || !m.end_ts || m.end_ts >= T) continue; const a = byWallet.get(p.wallet) ?? agg(); settle(p, a, false); byWallet.set(p.wallet, a); }
const scored = Array.from(byWallet.entries()).map(([w, a]) => { const z = (a.wins - a.sumP) / Math.sqrt(Math.max(a.sumVar, 1e-9)); const p = 0.5 * (1 - erf(z / Math.SQRT2)); return { w, n: a.n, cal: a.pnl / Math.max(a.risk, 1e-9), roi: a.pnl / Math.max(a.staked, 1e-9), p, lossP: 1 - p }; });
const sharp = new Set(scored.filter(s => s.n >= minN && s.p < 0.1 && s.cal > 0).map(s => s.w));
const fade = new Set(scored.filter(s => s.n >= minN && s.lossP < 0.1 && s.cal < 0).map(s => s.w));
const eligible = new Set(scored.filter(s => s.n >= minN).map(s => s.w));
// ---- out-of-sample (after cutoff): copy every BUY at fill + slippage, hold to resolution
const oos = trades.filter(t => t.ts >= T);
const groups: Record<string, Agg> = { sharp: agg(), fade: agg(), other_eligible: agg(), all_wallets: agg() };
const byCat: Record<string, Agg> = {};
const perWallet = new Map<string, Agg>();
for (const p of positions(oos)) {
    const m = mk.get(p.cid); if (!m) continue;
    const g = sharp.has(p.wallet) ? 'sharp' : fade.has(p.wallet) ? 'fade' : eligible.has(p.wallet) ? 'other_eligible' : null;
    settle(p, groups.all_wallets, true);
    if (g) settle(p, groups[g], true);
    if (g === 'sharp') { const c = byCat[m.category] ?? (byCat[m.category] = agg()); settle(p, c, true); const pw = perWallet.get(p.wallet) ?? agg(); settle(p, pw, true); perWallet.set(p.wallet, pw); }
}
const fmt = (a: Agg) => ({ positions: a.n, winRate: a.n ? +(a.wins / a.n).toFixed(3) : null, staked: Math.round(a.staked), pnl: Math.round(a.pnl), roi: a.staked ? +(a.pnl / a.staked).toFixed(4) : null, calibratedRoi: a.risk ? +(a.pnl / a.risk).toFixed(4) : null, equalWeightRoi: a.n ? +(a.eqPnl / a.n).toFixed(4) : null });
const result = {
    cutoff: new Date(T * 1000).toISOString(), daysAgo, minResolved: minN, slippageBps: slip * 10_000, resolvedMarkets: mk.size,
    inSample: { walletsScored: scored.length, eligible: eligible.size, sharp: sharp.size, fade: fade.size, sharpList: scored.filter(s => sharp.has(s.w)).sort((a, b) => b.cal - a.cal).map(s => ({ ...s, cal: +s.cal.toFixed(3), roi: +s.roi.toFixed(3), p: +s.p.toFixed(3), lossP: undefined })) },
    outOfSample: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, fmt(v)])),
    sharpByCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, fmt(v)])),
    sharpPerWallet: Array.from(perWallet.entries()).map(([w, a]) => ({ wallet: w, username: get<{ username: string }>('SELECT username FROM wallets WHERE address = ?', w)?.username ?? w.slice(0, 10), ...fmt(a) })).sort((a, b) => (b.pnl) - (a.pnl)),
    generatedAt: new Date().toISOString()
};
console.log(`cutoff ${result.cutoff} · resolved markets ${mk.size} · wallets scored in-sample ${scored.length} (eligible ${eligible.size}, sharp ${sharp.size}, fade ${fade.size})`);
console.table(result.outOfSample);
console.log('sharp wallets (in-sample):'); console.table(result.inSample.sharpList.slice(0, 15));
console.log('sharp OOS by category:'); console.table(result.sharpByCategory);
console.log('sharp OOS per wallet:'); console.table(result.sharpPerWallet.slice(0, 15));
kvSet(`backtest:walkforward:${daysAgo}d`, result);
console.log(`saved kv backtest:walkforward:${daysAgo}d`);
