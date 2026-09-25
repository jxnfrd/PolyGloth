import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb } from '../lib/pm/db';
import { kelly, kellyNo, bestSide, kalshiFee, scoreCalibration, scenarioPnl, paperPortfolio, breaker, paperPnlEvents, annualizedReturn } from '../lib/exec/risk';

/**
 * npx tsx scripts/pm-risk.ts kelly <q> <price> [bankroll=10000] [endDaysFromNow]
 * npx tsx scripts/pm-risk.ts calibration [who]
 * npx tsx scripts/pm-risk.ts scenario [strategy]      worst/best case of the open paper portfolio
 * npx tsx scripts/pm-risk.ts breaker [daily=500] [weekly=2000]
 */
(async () => {
    openDb();
    const [cmd = 'kelly', a1, a2, a3, a4] = process.argv.slice(2);
    switch (cmd) {
        case 'kelly': {
            const q = Number(a1), p = Number(a2), bank = Number(a3) || 10_000;
            if (!(q >= 0 && q <= 1 && p > 0 && p < 1)) throw new Error('usage: kelly <q 0..1> <price 0..1> [bankroll]');
            const b = bestSide(q, p);
            console.table({ side: b.side, ev: +b.ev.toFixed(4), fullKelly: +b.kelly.toFixed(4), quarterKellyUsd: Math.round(b.kelly * 0.25 * bank), kellyYes: +kelly(q, p).toFixed(4), kellyNo: +kellyNo(q, p).toFixed(4), kalshiFeePer100: kalshiFee(100, p) });
            if (a4) console.log('annualized return at ¼ Kelly edge:', (100 * annualizedReturn(b.ev, b.side === 'NO' ? 1 - p : p, Math.floor(Date.now() / 1000) + Number(a4) * 86_400)).toFixed(1) + '%/yr');
            break;
        }
        case 'calibration': { const r = scoreCalibration(a1); console.log({ n: r.n, brier: r.brier, marketBrier: r.marketBrier, logLoss: r.logLoss }); console.table(r.bins); break; }
        case 'scenario': { const { positions, eventOf } = paperPortfolio(a1); const r = scenarioPnl(positions, eventOf); console.log('positions', positions.length, 'worst', r.worst, 'best', r.best); console.table(r.exposureByEvent.slice(0, 15)); break; }
        case 'breaker': console.log(breaker(paperPnlEvents(), { dailyLossLimit: Number(a1) || 500, weeklyLossLimit: Number(a2) || 2000 })); break;
        default: throw new Error(`unknown command ${cmd}`);
    }
})().catch(e => { console.error(e); process.exit(1); });
