import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb } from '../lib/pm/db';
import { sync, scoreTags, attribution, portfolio, taxCsv, entries } from '../lib/report/journal';

/** Usage: npx tsx scripts/pm-journal.ts [sync|tags|attribution|portfolio|tax <ISO|US>|list] */
(() => {
    openDb();
    const [cmd = 'sync', a1] = process.argv.slice(2);
    switch (cmd) {
        case 'sync': console.log(sync()); break;
        case 'list': console.table(entries(50).map(e => ({ when: new Date(e.ts * 1000).toISOString().slice(0, 16), strategy: e.strategy, market: (e.question ?? e.condition_id).slice(0, 50), side: `${e.side} ${e.outcome_index}`, price: e.price, usd: e.usd, tags: e.tags.join(' '), outcome: e.outcome, pnl: e.pnl }))); break;
        case 'tags': console.table(scoreTags().map(t => ({ tag: t.tag, n: t.n, resolved: t.resolved, hit: t.hitRate === null ? '' : (100 * t.hitRate).toFixed(0) + '%', pnl: t.pnl.toFixed(0), roi: t.roi === null ? '' : (100 * t.roi).toFixed(1) + '%' }))); break;
        case 'attribution': { const a = attribution(Number(process.env.FEE_BPS) || 0); console.table([...a.byStrategy, a.total].map(x => ({ strategy: x.strategy, n: x.n, realized: x.realized.toFixed(2), skill_CLV: x.skill.toFixed(2), slippage: x.slippage.toFixed(2), fees: x.fees.toFixed(2), luck: x.luck.toFixed(2) }))); break; }
        case 'portfolio': { const p = portfolio(); console.log(p.totals, p.kalshiNote); console.table(p.byCategory); console.table(p.lines.slice(0, 30).map(l => ({ strategy: l.strategy, market: (l.question ?? l.condition_id).slice(0, 45), side: l.outcome_index, cost: l.cost.toFixed(0), mark: l.mark, value: l.value?.toFixed(0), unrealized: l.unrealized?.toFixed(0) }))); break; }
        case 'tax': process.stdout.write(taxCsv(a1 || 'ISO')); break;
        default: throw new Error(`unknown command ${cmd}`);
    }
})();
