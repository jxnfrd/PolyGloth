import { createClient } from '@supabase/supabase-js';
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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function testInsert() {
    console.log("🧪 Testing Single DB Insert...");

    // Payload with NEW fields
    const payload = {
        market_id: "999999",
        market_slug: "debug-test-market",
        market_title: "DEBUG: Will DB Accept This?",
        market_liquidity: 1000,

        article_url: "https://example.com",
        article_language: "en",
        source_outlet: "DEBUG_TEST",
        news_published_at: new Date().toISOString(),

        source_credibility: "low",

        key_finding: "Test finding",
        evidence_type: "NEWS_MEDIA",
        contradiction_score: 10,
        confidence: "Low",
        tier: 3,
        time_advantage_hours: 0,

        freshness_score: 5,
        indicator_color: "red",
        processing_log: ["Debug Test Insert"],

        status: "REJECTED" // <--- The critical new field
    };

    const { data, error } = await supabase.from('contrarian_signals').insert([payload]).select();

    if (error) {
        console.error("❌ INSERT FAILED!");
        console.error("   Code:", error.code);
        console.error("   Message:", error.message);
        console.error("   Details:", error.details);
        console.error("   Hint:", error.hint);
    } else {
        console.log("✅ INSERT SUCCESS!");
        console.log("   Inserted ID:", data[0]?.id);
        console.log("   The DB schema is CORRECT.");
    }
}

testInsert();
