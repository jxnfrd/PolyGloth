import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function clean() {
    console.log('🧹 Cleaning up Test Data...');

    // Delete the manual test whale signal
    const { error: wError } = await supabase.from('whale_signals').delete().eq('market_id', 'test-market-1');
    if (wError) console.error('Error deleting test whale:', wError);
    else console.log('✅ Deleted dummy whale signal.');

    // Delete "Test Market" if any exists in contrarian_signals (often used in dev)
    const { error: cError } = await supabase.from('contrarian_signals').delete().ilike('market_title', '%Test Market%');
    if (cError) console.error('Error deleting test signals:', cError);
    else console.log('✅ Deleted dummy news signals.');

    console.log('✨ Database clean. Now running real scans...');
}

clean();
