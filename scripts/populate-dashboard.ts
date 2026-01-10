import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Manual Env Load
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = dotenv.parse(fs.readFileSync(envPath));
        for (const k in envConfig) {
            process.env[k] = envConfig[k];
        }
    }
} catch (e) {
    console.error("Env load error", e);
}

// Import Orchestrator
import { runScan } from '../lib/intelligence/orchestrator';

async function main() {
    console.log("🚀 Starting Manual Dashboard Population...");
    console.log("   This will run the full Orchestrator pipeline and save ALL signals (Active & Rejected).");

    try {
        // Run verification scan (Limit 5 markets for speed)
        console.log("   -> Running Scan (Limit: 5)...");
        const result = await runScan(5);

        console.log("\n✅ Scan Complete!");
        console.log(`   Scanned: ${result.marketsScanned}`);
        console.log(`   Signals: ${result.signalsFound}`);
        console.log("\ncheck your Admin Dashboard now. You should see 'Rejected' signals if the AI deemed them low confidence.");
    } catch (e) {
        console.error("\n❌ Scan Failed:", e);
        console.log("\n[TIP] If the error is about 'column status does not exist', please run the migration '20260110_add_signal_status.sql' in your Supabase SQL Editor.");
    }
}

main();
