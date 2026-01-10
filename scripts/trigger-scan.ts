import 'dotenv/config';
// Ensure we load .env.local for scripts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { runScan } from '../lib/intelligence/orchestrator';

async function trigger() {
    console.log('🚀 Triggering Manual Scan (Tier 3 Enabled)...');
    try {
        const result = await runScan();
        console.log(`\n✅ Scan Complete!`);
        console.log(`   Markets Scanned: ${result.marketsScanned}`);
        console.log(`   Signals Generated: ${result.signalsFound}`);

        if (result.signalsFound > 0) {
            console.log('\nCheck your dashboard for new signals! 📊');
        } else {
            console.log('\nNo signals found (check logs for details).');
        }
    } catch (e) {
        console.error('Scan Failed:', e);
    }
}

trigger();
