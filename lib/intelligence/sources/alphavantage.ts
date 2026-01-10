import axios from 'axios';
import { ForexRate } from '../types/sources';

const BASE_URL = 'https://www.alphavantage.co/query';
// Simple in-memory timestamp for rate limiting (single instance)
let lastCallTime = 0;
const MIN_INTERVAL_MS = 12000; // 5 calls per minute = 1 call per 12s to be safe

async function waitRateLimit() {
    const now = Date.now();
    const timeSinceLast = now - lastCallTime;
    if (timeSinceLast < MIN_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL_MS - timeSinceLast));
    }
    lastCallTime = Date.now();
}

export async function fetchForexRate(from: string, to: string): Promise<ForexRate | null> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return null;

    await waitRateLimit();

    try {
        const response = await axios.get(BASE_URL, {
            params: {
                function: 'CURRENCY_EXCHANGE_RATE',
                from_currency: from,
                to_currency: to,
                apikey: apiKey
            }
        });

        const data = response.data['Realtime Currency Exchange Rate'];
        if (!data) return null;

        return {
            source: 'ALPHAVANTAGE',
            from: data['1. From_Currency Code'],
            to: data['3. To_Currency Code'],
            rate: parseFloat(data['5. Exchange Rate']),
            date: data['6. Last Refreshed']
        };
    } catch (error) {
        console.error(`Error fetching Forex ${from}/${to}:`, error);
        return null;
    }
}

export async function fetchNewsSentiment(keywords: string): Promise<string[] | null> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return null;

    await waitRateLimit();

    try {
        const response = await axios.get(BASE_URL, {
            params: {
                function: 'NEWS_SENTIMENT',
                topics: keywords, // or tickers
                limit: 5,
                apikey: apiKey
            }
        });

        if (!response.data.feed) return null;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return response.data.feed.map((item: any) =>
            `${item.title} (Sentiment: ${item.overall_sentiment_label})`
        );
    } catch (error) {
        console.error('Error fetching AlphaVantage sentiment:', error);
        return null;
    }
}
