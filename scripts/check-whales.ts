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
        console.log('⚠️ No signals found. Scraper might be failing to parse positions.');
    } else {
        console.log('✅ Signals exist in DB. Issue might be visibility/filtering.');
        // Show sample
        const { data } = await supabase.from('whale_signals').select('*').limit(1);
        console.log('Sample:', data);
    }
}

check();
