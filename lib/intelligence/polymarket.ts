import axios from 'axios';

/**
 * Polymarket Gamma REST API (public, no key).
 *
 * Audit 2026-09-25: the old call used `volume_min` (ignored by the API) and
 * `order=volume` (a STRING column, so "999.99" sorted above "2067740.47").
 * Result: the "top markets" were $1k tennis handicaps and weather bets.
 * Correct params are `volume_num_min` and `order=volume24hr` / `volumeNum`.
 */
const POLYMARKET_API_URL = 'https://gamma-api.polymarket.com/markets';

export interface PolymarketMarket {
    id: string;
    conditionId: string;
    /** Event slug, i.e. what polymarket.com/event/<slug> expects. Never null. */
    slug: string;
    question: string;
    description: string;
    outcomes: string[];
    /** Current YES/NO prices as numbers (0..1), same order as `outcomes`. */
    outcomePrices: number[];
    /** Implied probability of outcomes[0] (usually "Yes"). */
    yesPrice: number;
    /** Lifetime volume in USD. */
    volume: number;
    volume24hr: number;
    liquidity: number;
    startDate: string;
    endDate: string;
    isSports: boolean;
    resolutionSource: string;
}

export interface FetchMarketsOptions {
    /** Minimum lifetime volume in USD. Default 50k. */
    minVolume?: number;
    /** Drop sports / esports game markets (useless for news arbitrage). Default true. */
    excludeSports?: boolean;
    /** Drop markets whose YES price is outside [minEdgePrice, 1-minEdgePrice]. Default 0.03 (skip near-certain markets). */
    minEdgePrice?: number;
    /** 'volume24hr' (default) or 'volumeNum' or 'liquidityNum'. */
    order?: 'volume24hr' | 'volumeNum' | 'liquidityNum';
}

function num(v: unknown): number {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
}

function parseJsonArray(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(String);
    try { const p = JSON.parse(String(v ?? '[]')); return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeMarket(m: any): PolymarketMarket {
    const outcomes = parseJsonArray(m.outcomes);
    const prices = parseJsonArray(m.outcomePrices).map(num);
    const eventSlug: string | undefined = m.events?.[0]?.slug;
    const isSports = Boolean(m.sportsMarketType || m.gameId || m.gameStartTime);
    return {
        id: String(m.id),
        conditionId: String(m.conditionId ?? ''),
        slug: eventSlug || String(m.slug ?? ''),
        question: String(m.question ?? ''),
        description: String(m.description ?? ''),
        outcomes,
        outcomePrices: prices,
        yesPrice: prices[0] ?? 0.5,
        volume: num(m.volumeNum ?? m.volume),
        volume24hr: num(m.volume24hr),
        liquidity: num(m.liquidityNum ?? m.liquidity),
        startDate: String(m.startDate ?? ''),
        endDate: String(m.endDate ?? ''),
        isSports,
        resolutionSource: String(m.resolutionSource ?? '')
    };
}

export async function fetchActiveMarkets(limit: number = 50, opts: FetchMarketsOptions = {}): Promise<PolymarketMarket[]> {
    const { minVolume = 50_000, excludeSports = true, minEdgePrice = 0.03, order = 'volume24hr' } = opts;
    try {
        // Over-fetch because we filter client-side (sports dominate 24h volume).
        const response = await axios.get(POLYMARKET_API_URL, {
            params: {
                limit: Math.min(500, limit * 4),
                active: true,
                closed: false,
                volume_num_min: minVolume,
                order,
                ascending: false
            },
            timeout: 15_000
        });

        if (!Array.isArray(response.data)) return [];

        const markets = response.data.map(normalizeMarket).filter(m => {
            if (!m.slug || !m.question) return false;
            if (excludeSports && m.isSports) return false;
            if (m.yesPrice < minEdgePrice || m.yesPrice > 1 - minEdgePrice) return false;
            return true;
        });

        return markets.slice(0, limit);
    } catch (error) {
        console.error('Error fetching Polymarket markets:', error);
        return [];
    }
}

/** Resolution lookup used by backtests: winner index or null if not resolved. */
export async function fetchResolution(conditionId: string): Promise<{ closed: boolean; winnerIndex: number | null }> {
    try {
        const r = await axios.get(`https://clob.polymarket.com/markets/${conditionId}`, { timeout: 15_000 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const idx = (r.data.tokens || []).findIndex((t: any) => t.winner === true);
        return { closed: Boolean(r.data.closed) && idx >= 0, winnerIndex: idx >= 0 ? idx : null };
    } catch {
        return { closed: false, winnerIndex: null };
    }
}
