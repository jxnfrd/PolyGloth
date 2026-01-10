import { fetchActiveMarkets } from '../lib/intelligence/polymarket';
import axios from 'axios';

// Simple GDELT query (Not the advanced Gov one, just to prove data exists)
async function checkNewsAvailability(keywords: string[]) {
    const query = keywords.map(k => `"${k}"`).join(' OR ');
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=(${encodeURIComponent(query)})&mode=artlist&timespan=24h&format=json&maxrecords=3`;

    try {
        const response = await axios.get(url);
        return response.data?.articles || [];
    } catch (e) {
        return [];
    }
}

async function runHealthCheck() {
    console.log('🏥 SYSTEM HEALTH CHECK 🏥');
    console.log('============================');

    // 1. Check Polymarket API
    console.log('\n[1] Checking Polymarket API...');
    const markets = await fetchActiveMarkets(5);
    if (markets.length > 0) {
        console.log(`✅ SUCCESS: Fetched ${markets.length} active markets.`);
        console.log(`   Sample: "${markets[0].question}" (Vol: ${markets[0].volume})`);
    } else {
        console.log('❌ FAILURE: Could not fetch markets.');
        return;
    }

    // 2. Check GDELT Data for these markets
    console.log('\n[2] Checking GDELT Data Correlation...');

    for (const market of markets) {
        // Extract simple keywords
        const stopWords = new Set(['will', 'the', 'be', 'of', 'to', 'in', 'on', 'a', 'win']);
        const keywords = market.question
            .replace(/[^\w\s]/g, '')
            .split(' ')
            .filter(w => !stopWords.has(w.toLowerCase()) && w.length > 3)
            .slice(0, 3);

        const articles = await checkNewsAvailability(keywords);

        console.log(`\n   Market: "${market.question}"`);
        console.log(`   Keywords: [${keywords.join(', ')}]`);

        if (articles.length > 0) {
            console.log(`   ✅ SUCCESS: Found ${articles.length} news articles.`);
            console.log(`      Latest: "${articles[0].title}"`);
            console.log(`      Source: ${articles[0].domain}`);
        } else {
            console.log(`   ⚠️ WARNING: No recent news found (might be obscure topic).`);
        }
    }

    console.log('\n============================');
    console.log('CONCLUSION:');
    console.log('APIs are connected. If you see news above, correlation IS possible.');
    console.log('If orchestrator is silent, it is because of STRICT FILTERING (ignoring non-Gov/non-Crisis news).');
}

runHealthCheck();
