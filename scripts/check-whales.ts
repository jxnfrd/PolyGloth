import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
    console.log('🕵️ Checking Whale Data...');

    const { count: traders } = await supabase.from('tracked_traders').select('*', { count: 'exact', head: true });
    const { count: signals } = await supabase.from('whale_signals').select('*', { count: 'exact', head: true });

    console.log(`🐳 Tracked Traders: ${traders}`);
    console.log(`📶 Whale Signals: ${signals}`);

    if (signals === 0) {
        console.log('⚠️ No signals found.');
    } else {
        console.log('✅ Signals in DB:');
        const { data } = await supabase.from('whale_signals').select('market_question, position_size_usd, discovered_at, trader_action').order('discovered_at', { ascending: false }).limit(20);
        console.table(data);
    }
}

check();
