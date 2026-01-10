import 'dotenv/config';
// Ensure we load .env.local for scripts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { runScan } from '@/lib/intelligence/orchestrator';

async function test() {
    console.log('Starting test scan...');
    try {
        const result = await runScan();
        console.log(`Scanned ${result.marketsScanned} markets`);
        console.log(`Found ${result.signalsFound} new signals`);
    } catch (error) {
        console.error('Test scan failed:', error);
    }
}

test();
