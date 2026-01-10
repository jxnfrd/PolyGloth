import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function diagnose() {
    console.log('🕵️‍♂️ DIAGNOSTIC REPORT\n');

    // 1. ADMIN ACCESS (Service Role)
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
    const { count: adminSignals, error: adminError } = await adminClient.from('contrarian_signals').select('*', { count: 'exact', head: true });

    console.log(`[ADMIN] Signals Count: ${adminSignals} (Error: ${adminError?.message || 'None'})`);

    // 2. PUBLIC ACCESS (Anon Key)
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { count: anonSignals, error: anonError } = await anonClient.from('contrarian_signals').select('*', { count: 'exact', head: true });

    console.log(`[ANON]  Signals Count: ${anonSignals} (Error: ${anonError?.message || 'None'})`);

    if (adminSignals !== null && anonSignals === null) {
        console.error('❌ RLS BLOCKING READS! The Anon client cannot see the data.');
    } else if (adminSignals === anonSignals) {
        console.log('✅ RLS Configured Correctly (Anon sees same count as Admin).');
    }

    // 3. WHALE SIGNALS CHECK
    const { count: whaleCount, error: whaleError } = await adminClient.from('whale_signals').select('*', { count: 'exact', head: true });
    console.log(`\n[ADMIN] Whale Signals: ${whaleCount} (Error: ${whaleError?.message || 'None'})`);

    // 4. TEST INSERT WHALE
    if (whaleCount === 0) {
        console.log('   ⚠️ Table is empty. Attempting test insert...');
        // First get a trader
        const { data: trader } = await adminClient.from('tracked_traders').select('id').limit(1).single();
        if (!trader) {
            console.log('   ❌ No traders found to link signal to.');
        } else {
            const { error: insertError } = await adminClient.from('whale_signals').insert({
                trader_id: trader.id,
                market_id: 'test-market-1',
                market_slug: 'test-market',
                market_question: 'Test Market Question',
                trader_action: 'YES',
                position_size_usd: 100,
                average_buy_price: 0.5,
                signal_strength: 'low'
            });
            if (insertError) console.error(`   ❌ Insert Failed: ${insertError.message}`);
            else console.log('   ✅ Test Insert Successful!');
        }
    }
}

diagnose();
