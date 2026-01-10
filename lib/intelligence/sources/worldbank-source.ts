import axios from 'axios';
import { EconomicIndicator } from '../types/sources';

const BASE_URL = 'https://api.worldbank.org/v2';

export async function fetchIndicator(countryCode: string, indicatorCode: string): Promise<EconomicIndicator | null> {
    try {
        const response = await axios.get(`${BASE_URL}/country/${countryCode}/indicator/${indicatorCode}`, {
            params: {
                format: 'json',
                per_page: 1  // Default sorts by date desc usually
            }
        });

        // World Bank response is [ metadata, [data...] ]
        const data = response.data?.[1]?.[0];
        if (!data || data.value === null) return null;

        return {
            source: 'WORLDBANK',
            seriesId: indicatorCode,
            title: data.indicator?.value || indicatorCode,
            latestValue: data.value,
            date: data.date,
            unit: 'N/A', // Metadata not always clean in light response
            country: data.country?.value || countryCode
        };
    } catch (error) {
        console.error(`Error fetching WorldBank ${countryCode}/${indicatorCode}:`, error);
        return null;
    }
}
