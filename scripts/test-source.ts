import { fetchEconomicSeries } from '../lib/intelligence/sources/fred-source';
// import { fetchCompanyData } from '../lib/intelligence/sources/aletheia'; // Removed
import { fetchForexRate } from '../lib/intelligence/sources/alphavantage';
import { fetchIndicator } from '../lib/intelligence/sources/worldbank-source';
import { fetchTreasuryData } from '../lib/intelligence/sources/fiscaldata';
import { fetchActiveMarkets } from '../lib/intelligence/polymarket';
import { fetchNegativeSignals } from '../lib/intelligence/gdelt-advanced';

async function main() {
    console.log("==========================================");
    console.log("   POLYGLOT DATA FEED DIAGNOSTIC (6 APIs)  ");
    console.log("==========================================\n");

    // 1. Polymarket (Core Market Data)
    console.log("1. [MARKETS] Polymarket (Gamma API)...");
    try {
        const markets = await fetchActiveMarkets(1);
        if (markets.length > 0) console.log(`   ✅ SUCCESS: Fetched active market "${markets[0].question.substring(0, 40)}..."`);
        else console.log("   ⚠️ WARNING: No active markets found.");
    } catch (e) {
        console.log("   ❌ FAILED:", (e as Error).message);
    }

    // 2. GDELT (Core News Data)
    console.log("\n2. [NEWS] GDELT (Advanced Project)...");
    try {
        // Fetch negative signals for 'inflation' in US
        const news = await fetchNegativeSignals(["inflation"], "us");
        if (news.length > 0) console.log(`   ✅ SUCCESS: Fetched article "${news[0].title.substring(0, 40)}..."`);
        else console.log("   ⚠️ WARNING: No negative signals found for 'inflation' (this is possible).");
    } catch (e) {
        console.log("   ❌ FAILED:", (e as Error).message);
    }

    // 3. World Bank (Global Macro)
    console.log("\n3. [MACRO] WorldBank (China GDP)...");
    try {
        const gdp = await fetchIndicator('CN', 'NY.GDP.MKTP.KD.ZG');
        if (gdp) console.log(`   ✅ SUCCESS: China GDP Growth: ${gdp.latestValue}% (${gdp.date})`);
        else console.log("   ⚠️ WARNING: No data returned.");
    } catch (e) {
        console.log("   ❌ FAILED:", (e as Error).message);
    }

    // 4. Fiscal Data (US Treasury)
    console.log("\n4. [TREASURY] FiscalData (Exchange Rates)...");
    try {
        const treasury = await fetchTreasuryData('v1/accounting/od/rates_of_exchange', { 'country_currency_desc': 'eq:Canada-Dollar' });
        if (treasury) console.log(`   ✅ SUCCESS: Exchange Rate found for ${treasury.country_currency_desc}`);
        else console.log("   ⚠️ WARNING: No data returned.");
    } catch (e) {
        console.log("   ❌ FAILED:", (e as Error).message);
    }

    // 5. Alpha Vantage (Forex/Sentiment)
    console.log("\n5. [FOREX] AlphaVantage (EUR/USD)...");
    if (process.env.ALPHA_VANTAGE_API_KEY) {
        try {
            const rate = await fetchForexRate('EUR', 'USD');
            if (rate) console.log(`   ✅ SUCCESS: EUR/USD Rate: ${rate.rate}`);
            else console.log("   ⚠️ WARNING: API call succeeded but no data (Check limits).");
        } catch (e) {
            console.log("   ❌ FAILED:", (e as Error).message);
        }
    } else {
        console.log("   ⏭️ SKIPPED: No API Key.");
    }

    // 6. FRED (US Econ)
    console.log("\n6. [ECON] FRED (CPI)...");
    if (process.env.FRED_API_KEY) {
        try {
            const cpi = await fetchEconomicSeries('CPIAUCSL');
            if (cpi) console.log(`   ✅ SUCCESS: CPI Value: ${cpi.latestValue}`);
            else console.log("   ⚠️ WARNING: API call succeeded but no data.");
        } catch (e) {
            console.log("   ❌ FAILED:", (e as Error).message);
        }
    } else {
        console.log("   ⏭️ SKIPPED: No API Key.");
    }

    console.log("\n");
}

main();
