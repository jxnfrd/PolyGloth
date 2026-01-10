import axios from 'axios';
import { EconomicIndicator } from '../types/sources';

const BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

export async function fetchEconomicSeries(seriesId: string): Promise<EconomicIndicator | null> {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) {
        console.warn('FRED_API_KEY missing.');
        return null;
    }

    try {
        const response = await axios.get(BASE_URL, {
            params: {
                series_id: seriesId,
                api_key: apiKey,
                file_type: 'json',
                sort_order: 'desc',
                limit: 1
            }
        });

        const obs = response.data.observations?.[0];
        if (!obs) return null;

        return {
            source: 'FRED',
            seriesId: seriesId,
            title: seriesId, // FRED API series info endpoint is separate, assuming ID is known context for now
            latestValue: parseFloat(obs.value),
            date: obs.date,
            unit: 'Index/Value' // Would need series_info endpoint for real unit
        };
    } catch (error) {
        console.error(`Error fetching FRED series ${seriesId}:`, error);
        return null;
    }
}
