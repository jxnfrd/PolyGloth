import axios from 'axios';
import { CompanyFundamentals } from '../types/sources';

const BASE_URL = 'https://api.aletheiaapi.com';

export async function fetchCompanyData(symbol: string): Promise<CompanyFundamentals | null> {
    const apiKey = process.env.ALETHEIA_API_KEY;
    if (!apiKey) {
        console.warn('ALETHEIA_API_KEY is missing. Skipping company data fetch.');
        return null;
    }

    try {
        // Fetch Stock Data
        const response = await axios.get(`${BASE_URL}/StockData`, {
            headers: { key: apiKey },
            params: { symbol: symbol.toUpperCase() }
        });

        const data = response.data;
        // Basic validation - adjust based on actual API response structure
        if (!data || !data.Symbol) return null;

        return {
            source: 'ALETHEIA',
            symbol: data.Symbol,
            companyName: data.Company || data.Symbol, // Fallback
            sector: data.Sector || 'Unknown',
            latestPrice: parseFloat(data.Price) || 0,
            marketCap: parseFloat(data.MarketCap) || 0,
            keyStats: {
                peRatio: parseFloat(data.PE) || 0,
                dividendYield: parseFloat(data.DividendYield) || 0,
                profitMargin: parseFloat(data.ProfitMargin) || 0
            },
            nextEarningsDate: data.NextEarningsDate || 'N/A'
        };
    } catch (error) {
        console.error(`Error fetching Aletheia data for ${symbol}:`, error);
        return null;
    }
}
