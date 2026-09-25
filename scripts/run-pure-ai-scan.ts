import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

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

// Imports
import { fetchActiveMarkets } from '../lib/intelligence/polymarket';
import { generatePureAIPrediction } from '../lib/intelligence/pure-ai-analyst';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function runPureAIScan(limit = 10) {
    console.log(`🤖 Starting Pure AI Analysis Scan (Limit: ${limit})...`);

    // 1. Fetch Markets
    let markets = await fetchActiveMarkets(30, { excludeSports: true });

    // Shuffle and slice
    markets.sort(() => Math.random() - 0.5);
    const targetMarkets = markets.slice(0, limit);

    console.log(`🎯 Targeted ${targetMarkets.length} markets for Deep Reasoning.`);

    let processed = 0;

    for (const market of targetMarkets) {
        console.log(`\n>> ANALYZING: "${market.question}"`);

        // 2. Check if already analyzed recently (Optimization)
        const { data: existing } = await supabase
            .from('pure_ai_predictions')
            .select('id')
            .eq('market_id', market.id)
            .single();

        if (existing) {
            console.log("   [SKIP] Already analyzed.");
            continue;
        }

        // 3. AI Analysis
        // Rate limit: 4s delay
        await new Promise(r => setTimeout(r, 1000));

        const prediction = await generatePureAIPrediction(market);

        if (prediction) {
            console.log(`   💡 PREDICTION: ${prediction.estimatedProbability}% | ${prediction.confidence_level}`);
            console.log(`      "${prediction.summary}"`);

            // 4. Save to DB
            // Column names differ from the in-memory shape; the old direct insert failed silently on every row (0 rows in prod).
            const { error } = await supabase.from('pure_ai_predictions').upsert({
                market_id: prediction.market_id,
                market_slug: prediction.market_slug,
                market_question: prediction.market_question,
                market_yes_price: prediction.market_yes_price,
                prediction_summary: prediction.summary,
                reasoning: prediction.reasoning,
                estimated_probability: prediction.estimatedProbability,
                confidence_level: prediction.confidence_level,
                ai_model_used: prediction.ai_model_used,
                analysis_timestamp: new Date().toISOString()
            }, { onConflict: 'market_id' });
            if (error) {
                console.error("   ❌ DB Error:", error.message);
            } else {
                console.log("   ✅ Saved to DB");
                processed++;
            }
        } else {
            console.log("   ❌ AI Analysis Failed");
        }
    }

    console.log(`\n🏁 Scan Complete. Processed ${processed} new predictions.`);
}

runPureAIScan();
