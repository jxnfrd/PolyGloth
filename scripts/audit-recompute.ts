// Independent recomputation of wallet scores from raw trades (no imports from lib/intel) to cross-check wallet-score.ts.
import { config } from 'dotenv'; config({ path: '.env.local', quiet: true });
import { openDb, all, get } from '../lib/pm/db';
openDb();
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['nigiri99', 'mooseborzoi', 'ndb1'];
for (const name of names) {
    const w = get<{ address: string }>('SELECT address FROM wallets WHERE username = ? OR address = ? LIMIT 1', name, name.toLowerCase());
    if (!w) { console.log(name, 'not found'); continue; }
    const trades = all<{ condition_id: string; outcome_index: number; side: string; size: number; price: number; ts: number; event_slug: string }>('SELECT condition_id, outcome_index, side, size, price, ts, event_slug FROM trades WHERE wallet = ? ORDER BY ts', w.address);
    type Pos = { buyShares: number; buyCost: number; sellShares: number; sellProceeds: number; cid: string; oi: number };
    const pos = new Map<string, Pos>();
    for (const t of trades) {
        if (/updown|up-or-down/i.test(t.event_slug)) continue;
        const k = `${t.condition_id}|${t.outcome_index}`; const p = pos.get(k) ?? { buyShares: 0, buyCost: 0, sellShares: 0, sellProceeds: 0, cid: t.condition_id, oi: t.outcome_index };
        if (t.side === 'BUY') { p.buyShares += t.size; p.buyCost += t.size * t.price; } else { p.sellShares += t.size; p.sellProceeds += t.size * t.price; }
        pos.set(k, p);
    }
    // hedged: both outcomes of a condition held
    const sides = new Map<string, Set<number>>(); Array.from(pos.values()).forEach(p => { if (!sides.has(p.cid)) sides.set(p.cid, new Set()); sides.get(p.cid)!.add(p.oi); });
    let n = 0, wins = 0, staked = 0, pnl = 0, riskAdj = 0, sumP = 0, sumVar = 0, hedged = 0;
    Array.from(pos.values()).forEach(p => {
        if ((sides.get(p.cid)?.size ?? 0) > 1) { hedged++; return; }
        if (p.buyShares <= 0) return;
        const m = get<{ resolved: number; winner_index: number }>('SELECT resolved, winner_index FROM markets WHERE condition_id = ?', p.cid);
        if (!m || !m.resolved) return;
        const avg = p.buyCost / p.buyShares; const won = m.winner_index === p.oi;
        const sold = Math.min(p.sellShares, p.buyShares); const held = p.buyShares - sold;
        const realized = p.sellProceeds * (sold / Math.max(p.sellShares, 1e-9)) + (won ? held : 0) - p.buyCost;
        n++; if (won) wins++; staked += p.buyCost; pnl += realized;
        riskAdj += p.buyCost * Math.sqrt((1 - avg) / avg); sumP += avg; sumVar += avg * (1 - avg);
    });
    const z = (wins - sumP) / Math.sqrt(Math.max(sumVar, 1e-9)); const pval = 0.5 * (1 - erf(z / Math.SQRT2));
    const stored = get<Record<string, number>>(`SELECT n_resolved, wins, staked, pnl, roi, calibrated_roi, p_value FROM wallet_scores WHERE wallet = ? AND category = 'all' AND window_days = 0`, w.address);
    console.log(`\n${name} ${w.address}: ${trades.length} trades, ${pos.size} positions, ${hedged} hedged skipped`);
    console.log('  recomputed:', { n_resolved: n, wins, staked: Math.round(staked), pnl: Math.round(pnl), roi: +(pnl / staked).toFixed(3), calibrated_roi: +(pnl / riskAdj).toFixed(3), p_value: +pval.toFixed(3) });
    console.log('  stored    :', stored ? { n_resolved: stored.n_resolved, wins: stored.wins, staked: Math.round(stored.staked), pnl: Math.round(stored.pnl), roi: +Number(stored.roi).toFixed(3), calibrated_roi: +Number(stored.calibrated_roi).toFixed(3), p_value: +Number(stored.p_value).toFixed(3) } : 'none');
}
function erf(x: number) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
