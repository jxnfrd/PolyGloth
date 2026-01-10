import axios from 'axios';

const BASE_URL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';

// Generic fetcher for Treasury data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchTreasuryData(endpoint: string, filters: Record<string, string>): Promise<any | null> {
    try {
        const response = await axios.get(`${BASE_URL}/${endpoint}`, {
            params: {
                filter: Object.entries(filters).map(([k, v]) => `${k}:${v}`).join(','),
                sort: '-record_date',
                page: { size: 1 }
            }
        });

        return response.data.data?.[0] || null;
    } catch (error) {
        console.error(`Error fetching Treasury data:`, error);
        return null;
    }
}
