import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function forceSignal() {
    console.log('🔨 Forcing Mock Signal...');

    const mockSignal = {
        market_title: "Will OpenAI release GPT-5 before July 2025?",
        market_slug: "will-openai-release-gpt-5-before-july-2025",
        market_id: "mock-forced-signal-" + Date.now(),
        market_liquidity: 5000000,

        article_url: "https://techcrunch.com/openai-gpt5-rumors",
        article_language: "en",
        source_outlet: "TechCrunch",
        news_published_at: new Date().toISOString(),
        source_credibility: "high",

        key_finding: "Rumors suggest a delay in GPT-5 training run.",
        evidence_type: "NEWS_MEDIA",
        contradiction_score: 85,
        confidence: "High",
        tier: 3, // Standard News
        time_advantage_hours: 4,

        freshness_score: 99,
        indicator_color: "green",
        processing_log: ["Manually forced signal for testing."]
    };

    const { error } = await supabase.from('contrarian_signals').insert(mockSignal);

    if (error) {
        console.error('❌ Failed to insert:', error);
    } else {
        console.log('✅ Mock Signal Inserted Successfully!');
        console.log('   REFRESH YOUR DASHBOARD NOW.');
    }
}

forceSignal();
