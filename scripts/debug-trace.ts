import { SourceRouter } from '../lib/intelligence/source-router';
import { analyzeContradiction } from '../lib/intelligence/analyst';
import { PolymarketMarket } from '../lib/intelligence/polymarket';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Mock specific market for consistent testing
const MOCK_MARKET: PolymarketMarket = {
    id: "debug-123",
    slug: "apple-cpi-event",
    question: "Will US CPI for January be greater than 3.5%?",
    description: "This market resolves to yes if the CPI is > 3.5%",
    outcomes: "['Yes', 'No']",
    outcomePrices: "['0.5', '0.5']",
    volume: "1000",
    liquidity: "50000",
    startDate: "2024-01-01",
    endDate: "2024-02-01"
};

async function runTrace() {
    console.log("🔍 STARTING ORCHESTRATOR TRACE 🔍");
    console.log("-----------------------------------");
    console.log(`TARGET MARKET: "${MOCK_MARKET.question}"`);

    // 1. Context Collection
    console.log("\n[1] CONTEXT COLLECTION (SourceRouter)");
    const router = new SourceRouter();
    // Keywords mimicking the Orchestrator's extraction
    const keywords = ["CPI", "US", "Inflation"];
    const context = await router.routeAndFetch(MOCK_MARKET.question, keywords);

    console.log("Context Gathered:");
    console.log(`- Economics: ${context.economics?.length} items`);
    if (context.economics?.length) console.log(`  -> Sample: ${JSON.stringify(context.economics[0])}`);
    console.log(`- Fundamentals: ${context.fundamentals?.length} items`);
    console.log(`- Forex: ${context.forex?.length} items`);

    // 2. AI Analysis
    console.log("\n[2] AI ANALYSIS (Gemini via Analyst)");
    // Mock evidence (GDELT article)
    const mockEvidence = {
        title: "US Inflation rises unexpectedly to 3.8% in January",
        source: "Bloomberg",
        date: new Date().toISOString()
    };
    console.log(`Evidence: "${mockEvidence.title}"`);

    try {
        const analysis = await analyzeContradiction(MOCK_MARKET, mockEvidence, context);

        console.log("\n[3] AI RAW OUTPUT");
        if (analysis) {
            console.log(JSON.stringify(analysis, null, 2));

            // 4. Scoring Check
            console.log("\n[4] THRESHOLD CHECK");
            console.log(`Contradiction Score: ${analysis.contradictionScore}`);
            console.log(`Confidence: ${analysis.confidence}`);

            if (analysis.contradictionScore > 50) {
                console.log("✅ RESULT: SIGNAL WOULD BE GENERATED");
            } else {
                console.log("❌ RESULT: SIGNAL REJECTED (Score <= 50)");
            }
        } else {
            console.log("❌ AI Analysis returned null (Parsing failed or Error)");
        }

    } catch (e) {
        console.error("CRITICAL ERROR IN ANALYST:", e);
    }
}

runTrace();
