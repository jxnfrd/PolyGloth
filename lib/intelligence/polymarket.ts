import axios from 'axios';

// Fallback to Gamma REST API as GraphQL endpoints are authenticated or removed
const POLYMARKET_API_URL = 'https://gamma-api.polymarket.com/markets';

export interface PolymarketMarket {
    id: string;
    slug: string | null;
    question: string;
    description: string;
    outcomes: string;
    outcomePrices: string;
    volume: string;
    liquidity: string;
    startDate: string;
    endDate: string;
}

export async function fetchActiveMarkets(limit: number = 50): Promise<PolymarketMarket[]> {
    try {
        const response = await axios.get(POLYMARKET_API_URL, {
            params: {
                limit: limit,
                active: true,
                closed: false,
                volume_min: 50000,
                order: 'volume',
                ascending: false
            }
        });

        if (response.data && Array.isArray(response.data)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return response.data.map((m: any) => {
                // Try to find the Event Slug (most "real" link)
                // Use the first event's slug if available, otherwise market slug
                const eventSlug = m.events?.[0]?.slug;
                const bestSlug = eventSlug || m.slug;

                return {
                    id: m.id,
                    // If no slug found, pass ID which can be used for /market/[id] fallback
                    slug: bestSlug || null,
                    question: m.question,
                    description: m.description || '',
                    outcomes: JSON.stringify(m.outcomes),
                    outcomePrices: JSON.stringify(m.outcomePrices),
                    volume: m.volume,
                    liquidity: m.liquidity,
                    startDate: m.startDate,
                    endDate: m.endDate
                };
            });
        }

        return [];
    } catch (error) {
        console.error('Error fetching Polymarket markets:', error);
        return [];
    }
}
