import { config } from 'dotenv'; config({ path: '.env.local' });
import { WhaleTracker } from '../lib/intelligence/whale-tracker';

// Usage: npx tsx scripts/run-whale-scan.ts [scanCount=20] [poolSize=20] [minUsd=1000]
(async () => {
    const [scan = '20', pool = '20', min = '1000'] = process.argv.slice(2);
    const tracker = new WhaleTracker();
    const r = await tracker.updateTopTraders(Number(scan), Number(pool), { minPositionUsd: Number(min) });
    console.log('🏁', r);
})().catch(e => { console.error(e); process.exit(1); });
