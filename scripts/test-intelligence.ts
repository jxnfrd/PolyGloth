import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { fetchActiveMarkets } from '@/lib/intelligence/polymarket';
import { queryNonEnglishNews } from '@/lib/intelligence/gdelt';
import { analyzeContradiction } from '@/lib/intelligence/analyst';

async function testPipeline() {
    console.log('API Key Check:', process.env.GOOGLE_API_KEY ? 'Present' : 'Missing');

    console.log('--- Testing Polymarket Fetch ---');
    const markets = await fetchActiveMarkets(5);
    console.log(`Fetched ${markets.length} markets.`);
    if (markets.length > 0) console.log('Sample Market:', markets[0].question);

    console.log('\n--- Testing GDELT Scan ---');
    // Use a generic keyword or one from markets if available
    const keywords = ['Brazil', 'Crypto'];
    const news = await queryNonEnglishNews(keywords, ['pt']); // Test Portuguese
    console.log(`Fetched ${news.length} articles.`);
    if (news.length > 0) console.log('Sample Article:', news[0].title);

    console.log('\n--- Testing Analyst Engine ---');
    if (markets.length > 0 && news.length > 0) {
        console.log('Analyzing contradiction...');
        const result = await analyzeContradiction(markets[0], news[0]);
        console.log('Analysis Result:', result);
    } else {
        console.log('Skipping analysis (missing data).');
    }
}

testPipeline().catch(console.error);
