import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

const adminDb = createClient(URL, SERVICE_KEY);
const publicDb = createClient(URL, ANON_KEY);

async function audit() {
    console.log('🕵️ STARTING PRODUCTION AUDIT 🕵️');
    console.log(`Target: ${URL}`);

    const tables = ['whale_signals', 'contrarian_signals', 'pure_ai_predictions'];

    for (const table of tables) {
        console.log(`\n--- Checking Table: ${table} ---`);

        // 1. Check Total Count (Admin)
        const { count, error: countErr } = await adminDb.from(table).select('*', { count: 'exact', head: true });
        if (countErr) {
            console.error(`❌ Admin Read Failed: ${countErr.message}`);
            continue;
        }
        console.log(`📊 Total Rows (Admin View): ${count}`);

        // 2. Check Public Visibility (Anon)
        const { count: publicCount, error: pubErr } = await publicDb.from(table).select('*', { count: 'exact', head: true });
        if (pubErr) {
            console.error(`❌ Public Read Failed: ${pubErr.message}`);
        } else {
            console.log(`👀 Visible Rows (Public View): ${publicCount}`);

            if (count! > 0 && publicCount === 0) {
                console.error(`🚨 CRITICAL: RLS BLOCKING DATA! Admin sees ${count}, Public sees 0.`);
            } else if (count === 0) {
                console.warn(`⚠️ Table is empty. Ingestion pipeline is not running.`);
            } else {
                console.log(`✅ Table seems healthy.`);
            }
        }
    }
}

audit();
