import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

async function verify() {
    console.log('🕵️‍♀️ DB INTEGRITY CHECK 🕵️‍♀️');

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        console.error('❌ Missing Environment Variables!');
        console.error('   NEXT_PUBLIC_SUPABASE_URL:', url ? 'OK' : 'MISSING');
        console.error('   SUPABASE_SERVICE_ROLE_KEY:', key ? 'OK' : 'MISSING');
        return;
    }

    console.log('✅ Env Vars Loaded.');
    const supabase = createClient(url, key);

    // 1. Check Count
    const { count, error: countError } = await supabase.from('contrarian_signals').select('*', { count: 'exact', head: true });

    if (countError) {
        console.error('❌ Failed to count signals:', countError.message);
        return;
    }
    console.log(`📊 Current Signal Count: ${count}`);

    // 2. Check Latest Signal
    const { data: latest, error: readError } = await supabase.from('contrarian_signals').select('market_title, created_at').order('created_at', { ascending: false }).limit(3);
    if (readError) console.error('❌ Failed to read latest:', readError.message);
    else {
        console.log('\n📝 Latest 3 Signals in DB:');
        latest?.forEach(s => console.log(`   - [${new Date(s.created_at).toLocaleTimeString()}] ${s.market_title}`));
    }

    // 3. Test Write Permissions
    console.log('\n✍️  Testing Write Permissions...');
    const testSignal = {
        market_title: "TEST_SIGNAL_DELETE_ME",
        market_slug: "test-signal",
        market_id: "test-123",
        contradiction_score: 50,
        tier: 3,
        evidence_type: "TEST",
        article_url: "https://example.com"
    };

    const { data: insertData, error: insertError } = await supabase.from('contrarian_signals').insert(testSignal).select();

    if (insertError) {
        console.error('❌ INSERT FAILED:', insertError.message);
        console.error('   Running Migration `20260110_fix_links.sql` might be needed?');
    } else {
        console.log('✅ INSERT SUCCEEDED');

        // Cleanup
        const { error: delError } = await supabase.from('contrarian_signals').delete().eq('market_id', 'test-123');
        if (delError) console.error('⚠️ cleanup failed:', delError.message);
        else console.log('✅ CLEANUP SUCCEEDED');
    }

    console.log('\n__________________________');
    console.log('CONCLUSION:');
    if (!insertError && !readError) {
        console.log('Database is healthy. Application logic might be swallowing errors.');
    } else {
        console.log('Database permissions or schema issue detected.');
    }
}

verify();
