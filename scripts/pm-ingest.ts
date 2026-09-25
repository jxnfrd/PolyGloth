import { config } from 'dotenv'; config({ path: '.env.local' });
import { refreshAll, dbStats, ingestWalletTrades, ingestMarketTrades, ingestComments, ingestResolutions, ingestKalshi, ingestTopEvents, ingestLeaderboards } from '../lib/pm/ingest';
import { openDb, DB_PATH } from '../lib/pm/db';

/**
 * Usage:
 *   npx tsx scripts/pm-ingest.ts refresh [wallets=60] [maxTrades=3000]   full refresh (events, leaderboards, wallet trades, resolutions, kalshi)
 *   npx tsx scripts/pm-ingest.ts wallet <address> [maxTrades]
 *   npx tsx scripts/pm-ingest.ts market <conditionId> [maxTrades]
 *   npx tsx scripts/pm-ingest.ts comments <eventId> [max]
 *   npx tsx scripts/pm-ingest.ts resolutions [limit]
 *   npx tsx scripts/pm-ingest.ts events [limit] | leaderboards [limit] | kalshi | stats
 */
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

(async () => {
    openDb();
    const [cmd = 'stats', a1, a2] = process.argv.slice(2);
    const t0 = Date.now();
    switch (cmd) {
        case 'refresh': await refreshAll({ walletsToIngest: Number(a1) || 60, maxTradesPerWallet: Number(a2) || 3000, log }); break;
        case 'wallet': if (!a1) throw new Error('address required'); await ingestWalletTrades(a1, Number(a2) || 3000, log); break;
        case 'market': if (!a1) throw new Error('conditionId required'); await ingestMarketTrades(a1, Number(a2) || 3000, log); break;
        case 'comments': if (!a1) throw new Error('eventId required'); await ingestComments(a1, Number(a2) || 500, log); break;
        case 'resolutions': await ingestResolutions(Number(a1) || 600, 0, log); break;
        case 'events': await ingestTopEvents(Number(a1) || 200, 'volume24hr', log); break;
        case 'leaderboards': await ingestLeaderboards(Number(a1) || 100, log); break;
        case 'kalshi': await ingestKalshi(log); break;
        case 'stats': break;
        default: throw new Error(`unknown command ${cmd}`);
    }
    console.log(`db: ${DB_PATH}`);
    console.table(dbStats());
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch(e => { console.error(e); process.exit(1); });
