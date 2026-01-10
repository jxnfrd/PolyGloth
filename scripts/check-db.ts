import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkCounts() {
    const { count: signals } = await supabase.from('contrarian_signals').select('*', { count: 'exact', head: true });
    const { count: activeSignals } = await supabase.from('contrarian_signals').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE');
    const { count: ai } = await supabase.from('pure_ai_predictions').select('*', { count: 'exact', head: true });
    const { count: whales } = await supabase.from('whale_signals').select('*', { count: 'exact', head: true });
    const { count: traders } = await supabase.from('tracked_traders').select('*', { count: 'exact', head: true });

    console.log('--- DB COUNTS ---');
    console.log('Signals (Total):', signals);
    console.log('Signals (Active):', activeSignals);
    console.log('Pure AI Predictions:', ai);
    console.log('Whale Signals:', whales);
    console.log('Tracked Traders:', traders);
}

checkCounts();
