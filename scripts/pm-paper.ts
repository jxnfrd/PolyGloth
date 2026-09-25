import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb, all } from '../lib/pm/db';
import { pollLeaders, settlePaper, paperReport, copyLagReport, cancelAllPaper, rebalanceBasket, frontRunDetection, leaderDumpingAlert, DEFAULT_COPY_CONFIG } from '../lib/exec/copy-paper';

/**
 * Paper copy engine CLI.
 *   npx tsx scripts/pm-paper.ts poll [addr,addr,...]   copy new trades of leaders (default: top 10 wallets by lb_pnl_month in DB)
 *   npx tsx scripts/pm-paper.ts report                  paper P/L, copy-lag per leader
 *   npx tsx scripts/pm-paper.ts basket [addr,...]       weights for a leader basket
 *   npx tsx scripts/pm-paper.ts leader <addr>           front-run share + dumping alerts
 *   npx tsx scripts/pm-paper.ts kill [strategy]         close all open paper orders
 */
(async () => {
    openDb();
    const [cmd = 'report', a1, a2] = process.argv.slice(2);
    const defaultLeaders = () => all<{ address: string }>('SELECT address FROM wallets WHERE lb_rank_pnl_month IS NOT NULL AND trade_count > 0 ORDER BY lb_rank_pnl_month LIMIT 10').map(r => r.address);
    const leaders = a1 && a1.includes('0x') ? a1.split(',') : defaultLeaders();
    switch (cmd) {
        case 'poll': {
            const r = pollLeaders(leaders.map(address => ({ address })), DEFAULT_COPY_CONFIG);
            console.log('poll:', r); console.log('settled:', settlePaper(DEFAULT_COPY_CONFIG.strategy)); console.table(paperReport()); break;
        }
        case 'report': settlePaper(); console.table(paperReport()); console.table(copyLagReport(a1 || DEFAULT_COPY_CONFIG.strategy)); break;
        case 'basket': console.table(rebalanceBasket(leaders, Number(a2) || 30)); break;
        case 'leader': if (!a1) throw new Error('address required'); console.log('front-run:', frontRunDetection(a1.toLowerCase())); console.table(leaderDumpingAlert(a1.toLowerCase())); break;
        case 'kill': console.log('closed', cancelAllPaper(a1)); break;
        default: throw new Error(`unknown command ${cmd}`);
    }
})().catch(e => { console.error(e); process.exit(1); });
