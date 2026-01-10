'use server';

import { fetchActiveMarkets } from '@/lib/intelligence/polymarket';

export async function getActiveMarketsForAdmin() {
    try {
        const markets = await fetchActiveMarkets(50);
        return { success: true, data: markets };
    } catch (error) {
        console.error('Failed to fetch markets:', error);
        return { success: false, error: 'Failed to fetch markets' };
    }
}
