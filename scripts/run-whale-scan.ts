import { WhaleTracker } from '../lib/intelligence/whale-tracker';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function runWhaleScan() {
    console.log('🚀 Launching Whale Tracker...');

    // Safety check for environment
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        console.error('❌ Environment variables missing. Ensure .env.local is loaded.');
        // Note: When running via `npx tsx`, dotenv isn't auto-loaded unless we do it explicitly
        // or rely on the imports in the lib.
    }

    const tracker = new WhaleTracker();

    // Local Manual Scan: Check 5 traders from top 20
    await tracker.updateTopTraders(5, 20);

    console.log('🏁 Whale Scan Finished.');
}

runWhaleScan();
