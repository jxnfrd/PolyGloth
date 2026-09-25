import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb } from '../lib/pm/db';
import { ensureSchema, antiLeaderboard, fingerprintAll, biasFingerprint, fadeBacktest, emitFadeSignals, crowdOfLosers } from '../lib/intel/fade';

/** Usage: npx tsx scripts/pm-fade.ts [all|anti|fingerprint|backtest|signals|crowd <conditionId>] */
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const fmt = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '-' : n.toFixed(d));
(async () => {
    openDb(); ensureSchema();
    const [cmd = 'all', arg] = process.argv.slice(2);
    if (cmd === 'crowd') { console.log(JSON.stringify(crowdOfLosers(arg), null, 2)); return; }
    if (cmd === 'all' || cmd === 'anti') {
        const rows = antiLeaderboard({ minResolved: 50, maxLossP: 0.1, limit: 15 });
        console.log(`\n=== ANTI-LEADERBOARD (${rows.length}) ===`);
        console.table(rows.map(r => ({ wallet: (r.username || r.wallet).slice(0, 18), resolved: r.n_resolved, win: fmt(r.wins / r.n_resolved), staked: Math.round(r.staked), pnl: Math.round(r.pnl), roi: fmt(r.roi), cal: fmt(r.calibrated_roi), lossP: fmt(r.loss_p, 4), entry: fmt(r.avg_entry_price) })));
    }
    if (cmd === 'all' || cmd === 'fingerprint') {
        fingerprintAll(log);
        const rows = antiLeaderboard({ minResolved: 50, maxLossP: 0.1, limit: 10 });
        console.table(rows.map(r => { const f = biasFingerprint(r.wallet, { persist: false }); return { wallet: (r.username || r.wallet).slice(0, 18), longshot: fmt(f.longshot_share), lsRoi: fmt(f.longshot_roi), chaser: fmt(f.chaser_score, 3), chaserN: f.chaser_n, tilt: fmt(f.tilt_ratio), topCat: `${f.top_category} ${fmt(f.top_category_share)}`, oneSided: fmt(f.one_sided_share), tags: f.tags.join(',') }; }));
    }
    if (cmd === 'all' || cmd === 'backtest') {
        const r = fadeBacktest({ minResolved: 50, maxLossP: 0.1, feeBps: 0, slippageBps: 50 });
        console.log(`\n=== FADE BACKTEST (walk-forward, slippage 50bps) === wallets flagged ${r.flaggedWallets}, n ${r.n}, win ${fmt(r.n ? r.wins / r.n : null)}, staked ${Math.round(r.staked)}, pnl ${Math.round(r.pnl)}, roi ${fmt(r.roi)}`);
        console.table(Object.keys(r.byCategory).map(k => ({ category: k, n: r.byCategory[k].n, win: fmt(r.byCategory[k].wins / r.byCategory[k].n), pnl: Math.round(r.byCategory[k].pnl), roi: fmt(r.byCategory[k].roi) })));
    }
    if (cmd === 'all' || cmd === 'signals') log(`fade signals emitted: ${emitFadeSignals(24)}`);
})().catch(e => { console.error(e); process.exit(1); });
