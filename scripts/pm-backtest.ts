import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb } from '../lib/pm/db';
import { STRATEGIES } from '../lib/exec/strategies';
import { runBacktest, ensurePrices } from '../lib/exec/backtest';

/**
 * npx tsx scripts/pm-backtest.ts <near_certainty|deadline_decay|thin_move|all> [days=90] [--no-sports] [--fill-prices=N]
 * Fills hourly price history for resolved markets first (--fill-prices, default 200) — one CLOB call per market.
 */
import { kvSet } from '../lib/pm/db';

(async () => {
    openDb();
    const args = process.argv.slice(2);
    const name = args[0] || 'all', days = Number(args[1]) || 90;
    const noSports = args.includes('--no-sports');
    const fill = Number((args.find(a => a.startsWith('--fill-prices=')) || '--fill-prices=200').split('=')[1]);
    const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
    if (fill > 0) await ensurePrices(fill, days, log);
    const names = name === 'all' ? Object.keys(STRATEGIES) : [name];
    for (const n of names) {
        const s = STRATEGIES[n]; if (!s) throw new Error(`unknown strategy ${n}; have ${Object.keys(STRATEGIES).join(', ')}`);
        const r = runBacktest({ strategy: s(), days, excludeSports: noSports, log });
        console.log(`\n=== ${r.strategy} (${days}d, ${r.markets} markets, ${r.bars} bars) params=${JSON.stringify(r.params)}`);
        console.table({ n: r.n, winRate: +(100 * r.winRate).toFixed(1), staked: Math.round(r.staked), pnl: Math.round(r.pnl), roiPct: +(100 * r.roi).toFixed(2), maxDrawdown: Math.round(r.maxDrawdown) });
        console.table(Object.fromEntries(Object.entries(r.byCategory).map(([k, v]) => [k, { n: v.n, pnl: Math.round(v.pnl), roiPct: v.staked ? +(100 * v.pnl / v.staked).toFixed(1) : 0 }])));
        kvSet(`backtest:strategy:${r.strategy}`, { ...r, trades: r.trades.slice(0, 40), equity: r.equity.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 200)) === 0), days, excludeSports: noSports, generatedAt: new Date().toISOString() });
        for (const t of r.trades.slice(0, 5)) console.log(`  ${t.question.slice(0, 50).padEnd(50)} ${t.outcomeIndex === 0 ? 'YES' : 'NO '} @${t.entryPrice.toFixed(3)} $${t.usd.toFixed(0)} → ${t.exitReason} pnl ${t.pnl.toFixed(1)} | ${t.reason}`);
    }
})().catch(e => { console.error(e); process.exit(1); });
