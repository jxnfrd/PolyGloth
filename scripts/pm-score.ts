import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb } from '../lib/pm/db';
import { scoreAllWallets, topWallets, consensus, divergence, walletReport, edgeTrend } from '../lib/intel/wallet-score';
import { ALL_CATEGORIES } from '../lib/pm/categories';

/** Usage: npx tsx scripts/pm-score.ts [all|top|consensus|report <wallet>] */
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const fmt = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '-' : n.toFixed(d));
(async () => {
    openDb();
    const [cmd = 'all', arg] = process.argv.slice(2);
    if (cmd === 'report') { console.log(JSON.stringify(walletReport(arg), null, 2)); return; }
    if (cmd === 'all') scoreAllWallets(log);
    if (cmd === 'all' || cmd === 'top') {
        for (const cat of ['all'].concat(ALL_CATEGORIES)) {
            const rows = topWallets({ category: cat, minResolved: 30, maxP: 0.1, limit: 8 });
            if (!rows.length) continue;
            console.log(`\n=== TOP ${cat} (n_resolved>=30, p<0.1) ===`);
            console.table(rows.map(r => ({ wallet: (r.username || r.wallet).slice(0, 18), resolved: r.n_resolved, win: fmt(r.wins / r.n_resolved), staked: Math.round(r.staked), pnl: Math.round(r.pnl), roi: fmt(r.roi), cal: fmt(r.calibrated_roi), p: fmt(r.p_value, 3), entry: fmt(r.avg_entry_price), trend: edgeTrend(r.wallet, cat).trend })));
        }
        const worst = topWallets({ category: 'all', minResolved: 30, worst: true, limit: 8 });
        console.log('\n=== BOTTOM all ==='); console.table(worst.map(r => ({ wallet: (r.username || r.wallet).slice(0, 18), resolved: r.n_resolved, pnl: Math.round(r.pnl), roi: fmt(r.roi), cal: fmt(r.calibrated_roi), lossP: fmt(1 - (r.p_value ?? 1), 3) })));
    }
    if (cmd === 'all' || cmd === 'consensus') {
        const c = consensus({ windowHours: 48 }); console.log(`\n=== CONSENSUS (${c.length}) ===`); console.table(c.slice(0, 15).map(x => ({ q: x.question.slice(0, 50), side: x.outcome_index, wallets: x.wallets.length, usdc: Math.round(x.usdc) })));
        const d = divergence({ windowHours: 48 }); console.log(`\n=== DIVERGENCE (${d.length}) ===`); console.table(d.slice(0, 15).map(x => ({ q: x.question.slice(0, 50), smartSide: x.outcome_index, smart$: Math.round(x.smart_usdc), crowdOther: fmt(x.crowd_share_other) })));
    }
})().catch(e => { console.error(e); process.exit(1); });
