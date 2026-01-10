import { SourceRouter } from '../lib/intelligence/source-router';
import { analyzeContradiction } from '../lib/intelligence/analyst';
import { fetchActiveMarkets } from '../lib/intelligence/polymarket';
import { fetchNegativeSignals } from '../lib/intelligence/gdelt-advanced';
import * as fs from 'fs';
import * as path from 'path';

// 1. ROBUST ENV LOADER (Bypassing potential dotenv issues)
function loadEnv() {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');

            // Extract GOOGLE_API_KEY
            const gMatch = content.match(/GOOGLE_API_KEY=["']?([^"'\n]+)["']?/);
            if (gMatch) {
                process.env.GOOGLE_API_KEY = gMatch[1];
                console.log("✅ GOOGLE_API_KEY loaded manually.");
            }

            // Extract GEMINI_API_KEY
            const gemMatch = content.match(/GEMINI_API_KEY=["']?([^"'\n]+)["']?/);
            if (gemMatch) {
                process.env.GEMINI_API_KEY = gemMatch[1];
                console.log("✅ GEMINI_API_KEY loaded manually.");
            }

            // Extract ALPHA_VANTAGE
            const avMatch = content.match(/ALPHA_VANTAGE_API_KEY=["']?([^"'\n]+)["']?/);
            if (avMatch) process.env.ALPHA_VANTAGE_API_KEY = avMatch[1];

            // Extract FRED
            const fredMatch = content.match(/FRED_API_KEY=["']?([^"'\n]+)["']?/);
            if (fredMatch) process.env.FRED_API_KEY = fredMatch[1];
        } else {
            console.error("❌ .env.local not found!");
        }
    } catch (e) {
        console.error("Manual env load failed:", e);
    }
}

loadEnv();

async function runRealScan() {
    console.log("\n🚀 LAUNCHING LIVE SIGNAL GENERATION TEST");
    console.log("-----------------------------------------");

    // 2. FETCH REAL MARKETS
    console.log("📡 Fetching active markets from Polymarket...");
    let markets = [];
    try {
        markets = await fetchActiveMarkets(20);
    } catch (e: any) {
        console.error("Failed to fetch markets:", e);
        return;
    }

    // Filter for interesting ones (exclude generic sports if possible, though Poly is heavy on sports)
    // We'll look for keywords like "Trump", "Biden", "Rate", "Fed", "CPI", "Price", "Economy"
    const keywordsOfInterest = ["TRUMP", "BIDEN", "RATE", "FED", "CPI", "GDP", "INFLATION", "BITCOIN", "ETH", "STOCKS"];
    const candidates = markets.filter(m => {
        const qUpper = m.question.toUpperCase();
        return keywordsOfInterest.some(k => qUpper.includes(k));
    }).slice(0, 2); // Take top 2 matches

    // If no specific matches, just take top 2 non-sports
    const finalCandidates = candidates.length > 0 ? candidates : markets.slice(0, 2);

    console.log(`🎯 Selected ${finalCandidates.length} markets for Deep Analysis.\n`);

    const router = new SourceRouter();

    for (const market of finalCandidates) {
        console.log(`>> ANALYZING MARKET: "${market.question}"`);

        // 3. CONTEXT COLLECTION
        // Simple keyword extraction for test
        const keywords = market.question.split(" ").map(w => w.replace(/[^a-zA-Z]/g, '')).filter(w => w.length > 3);

        console.log(`   [Context] Routing keywords: [${keywords.join(', ')}]`);
        const context = await router.routeAndFetch(market.question, keywords);

        console.log(`   [Context] Stats: ${context.economics?.length || 0} Econ, ${context.fundamentals?.length || 0} Fund, ${context.forex?.length || 0} Forex`);
        if (context.economics?.length) console.log(`      -> Example Econ: ${context.economics[0].title}: ${context.economics[0].latestValue}`);

        // 4. EVIDENCE COLLECTION (GDELT)
        console.log(`   [News] Querying GDELT...`);
        let topNews = { title: "No breaking news found.", source: "N/A", date: new Date().toISOString() };
        try {
            const articles = await fetchNegativeSignals(keywords, 'us');
            if (articles.length > 0) {
                topNews = articles[0];
                console.log(`      -> Found Article: "${topNews.title}" (${topNews.source})`);
            } else {
                console.log(`      -> No negative signals found, using generic check.`);
            }
        } catch (e: any) {
            console.log(`      -> GDELT Error (skipping): ${e.message}`);
        }

        // 5. AI ANALYSIS
        console.log(`   [AI] Generating Signal...`);
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const newsEvidence: any = topNews;
            const analysis = await analyzeContradiction(market, {
                title: topNews.title,
                source: topNews.source,
                date: newsEvidence.seendate || newsEvidence.date || new Date().toISOString()
            }, context);

            if (analysis) {
                console.log(`\n   ⚡ SIGNAL GENERATED:`);
                console.log(`      Score: ${analysis.contradictionScore}/100 | Confidence: ${analysis.confidence}`);
                console.log(`      Key Finding: "${analysis.keyFinding}"`);
                console.log(`      Reasoning: "${analysis.reasoning}"`);
            } else {
                console.log(`   ❌ AI returned null.`);
            }
        } catch (e) {
            console.error(`   ❌ AI Crash:`, e);
        }
        console.log("-----------------------------------------");
    }
}

runRealScan();
