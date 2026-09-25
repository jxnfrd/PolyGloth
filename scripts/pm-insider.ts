import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb } from '../lib/pm/db';
import { ensureSchema, scan, ledger } from '../lib/intel/insider';

/** Usage: npx tsx scripts/pm-insider.ts [scan [limitMarkets=20] [days=3] | ledger | market <conditionId>] */
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
(async () => {
    openDb(); ensureSchema();
    const [cmd = 'scan', a1, a2] = process.argv.slice(2);
    if (cmd === 'ledger') { console.table(ledger()); return; }
    const r = cmd === 'market' ? await scan({ conditionIds: [a1], days: Number(a2) || 3, log }) : await scan({ limit: Number(a1) || 20, days: Number(a2) || 3, log });
    console.log(`\n=== INSIDER FLAGS: ${r.flags} across ${r.markets} markets ===`);
    console.table(r.flagsList.slice(0, 30).map(f => ({ score: f.score, reasons: f.reasons.join('+'), q: f.question.slice(0, 40), side: f.outcome_index, usdc: Math.round(f.usdc), price: f.price, ageH: f.wallet_age_h === null ? '-' : Math.round(f.wallet_age_h), vol24: Math.round(f.market_vol24), wallet: f.wallet.slice(0, 10) })));
    console.table(ledger());
})().catch(e => { console.error(e); process.exit(1); });
