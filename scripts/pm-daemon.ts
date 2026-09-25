import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb } from '../lib/pm/db';
import { loop, runJob, describeSchedule, JOBS, JobName, defaultLog } from '../lib/ops/daemon';

/**
 * Usage:
 *   npx tsx scripts/pm-daemon.ts              run forever (sequential jobs, SIGTERM-safe)
 *   npx tsx scripts/pm-daemon.ts --dry        print the schedule and exit
 *   npx tsx scripts/pm-daemon.ts --once <job> run one job and exit (refresh|chain|books|prices|kalshi|alerts)
 * Env: POLYGLOTH_DB, DAEMON_WALLETS (60), DAEMON_BOOKS (30), DAEMON_PRICES (400), DAEMON_CHAIN_RESOLUTIONS (8000)
 */
(async () => {
    openDb();
    const args = process.argv.slice(2);
    if (args.includes('--dry')) { console.log(describeSchedule()); return; }
    const once = args.indexOf('--once');
    if (once >= 0) {
        const job = args[once + 1] as JobName;
        if (!JOBS.some(j => j.name === job)) throw new Error(`unknown job "${job}"; one of ${JOBS.map(j => j.name).join(', ')}`);
        const s = await runJob(job, defaultLog);
        process.exit(s.lastOk ? 0 : 1);
    }
    let stop = false;
    const onSignal = (sig: string) => { defaultLog(`${sig} received; finishing current job then exiting`); stop = true; };
    process.on('SIGTERM', () => onSignal('SIGTERM'));
    process.on('SIGINT', () => onSignal('SIGINT'));
    await loop({ shouldStop: () => stop, pollSec: 60 });
})().catch(e => { console.error(e); process.exit(1); });
