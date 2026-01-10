import { fetchCompanyData } from './sources/aletheia';
import { fetchForexRate, fetchNewsSentiment } from './sources/alphavantage';
import { fetchEconomicSeries } from './sources/fred';
import { fetchIndicator } from './sources/worldbank';
// import { fetchTreasuryData } from './sources/fiscaldata'; // Could be added for bond yields
import { StandardizedContext } from './types/sources';

export class SourceRouter {

    // Determine which sources to query based on market context
    async routeAndFetch(marketTitle: string, keywords: string[]): Promise<StandardizedContext> {
        const context: StandardizedContext = {
            fundamentals: [],
            economics: [],
            forex: [],
            newsSentiment: []
        };

        const tasks: Promise<void>[] = [];
        const titleUpper = marketTitle.toUpperCase();

        // ---------------------------------------------------------
        // 1. Single Stock / Company Analysis
        // ---------------------------------------------------------
        // Detect Cashtags ($AAPL) or Ticker patterns
        const tickerMatch = marketTitle.match(/\$([A-Z]{1,5})\b/) || marketTitle.match(/\b(AAPL|MSFT|GOOG|AMZN|TSLA|NVDA|META)\b/i);

        if (tickerMatch) {
            const symbol = tickerMatch[1].toUpperCase();
            tasks.push((async () => {
                const data = await fetchCompanyData(symbol);
                if (data) context.fundamentals?.push(data);
            })());

            tasks.push((async () => {
                const sentiment = await fetchNewsSentiment(symbol);
                if (sentiment) context.newsSentiment?.push(...sentiment);
            })());
        }

        // ---------------------------------------------------------
        // 2. Macro Economics (Inflation/CPI/Fed)
        // ---------------------------------------------------------
        if (titleUpper.includes('CPI') || titleUpper.includes('INFLATION')) {
            tasks.push((async () => {
                const cpi = await fetchEconomicSeries('CPIAUCSL'); // US CPI
                if (cpi) context.economics?.push(cpi);
            })());
        }
        if (titleUpper.includes('UNEMPLOYMENT') || titleUpper.includes('JOBS REPORT')) {
            tasks.push((async () => {
                const unrate = await fetchEconomicSeries('UNRATE'); // US Unemployment
                if (unrate) context.economics?.push(unrate);
            })());
        }
        if (titleUpper.includes('FED RATES') || titleUpper.includes('INTEREST RATE')) {
            tasks.push((async () => {
                const fedFunds = await fetchEconomicSeries('FEDFUNDS');
                if (fedFunds) context.economics?.push(fedFunds);
            })());
        }

        // ---------------------------------------------------------
        // 3. Forex & Global Economics
        // ---------------------------------------------------------
        // Simple regex for "USD to EUR" or "Bitcoin"
        if (titleUpper.includes('EUR') || titleUpper.includes('EURO')) {
            tasks.push((async () => {
                const rate = await fetchForexRate('EUR', 'USD');
                if (rate) context.forex?.push(rate);
            })());
        }

        // Fiscal Data (Treasury) - Regex for "Real", "Peso", "Yen" etc or "Exchange Rate"
        if (titleUpper.includes('EXCHANGE RATE') || titleUpper.includes('FOREX') || titleUpper.includes('REAL') || titleUpper.includes('PESO')) {
            tasks.push((async () => {
                // Example: Search for Brazil Real if not found by AlphaVantage or as supplementary
                // Ideally we map Country -> Currency, but for now we look for generic matches or specific ones
                const { fetchTreasuryData } = await import('./sources/fiscaldata');
                // Simple example: default to checking a few major ones or dynamic filter if possible
                // For this V1, let's just fetch Brazil/Canada/Mexico if mentioned
                if (titleUpper.includes('BRAZIL') || titleUpper.includes('REAL')) {
                    const data = await fetchTreasuryData('v1/accounting/od/rates_of_exchange', { 'country_currency_desc': 'eq:Brazil-Real' });
                    if (data) context.forex?.push({ source: 'FISCALDATA', from: 'USD', to: 'BRL', rate: parseFloat(data.exchange_rate), date: data.record_date });
                }
            })());
        }

        // World Bank examples
        if (titleUpper.includes('CHINA GDP') || titleUpper.includes('CHINESE GROWTH')) {
            tasks.push((async () => {
                const gdp = await fetchIndicator('CN', 'NY.GDP.MKTP.KD.ZG'); // GDP Growth
                if (gdp) context.economics?.push(gdp);
            })());
        }


        // Execute all selected tasks in parallel (best effort)
        await Promise.allSettled(tasks);

        return context;
    }
}
