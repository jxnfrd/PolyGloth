import { getJson, qs, num, str } from './http';

const BASE = 'https://clob.polymarket.com';

export interface BookLevel { price: number; size: number }
export interface OrderBook {
    tokenId: string;
    bids: BookLevel[]; // sorted best (highest) first
    asks: BookLevel[]; // sorted best (lowest) first
    bestBid: number | null;
    bestAsk: number | null;
    mid: number | null;
    spread: number | null;
    fetchedAt: number;
}

export async function orderBook(tokenId: string): Promise<OrderBook> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = await getJson<any>(`${BASE}/book${qs({ token_id: tokenId })}`);
    const lv = (arr: unknown) => (Array.isArray(arr) ? (arr as { price?: unknown; size?: unknown }[]) : []).map(l => ({ price: num(l.price), size: num(l.size) })).filter(l => l.size > 0);
    const bids = lv(b.bids).sort((a, c) => c.price - a.price);
    const asks = lv(b.asks).sort((a, c) => a.price - c.price);
    const bestBid = bids[0]?.price ?? null, bestAsk = asks[0]?.price ?? null;
    return {
        tokenId, bids, asks, bestBid, bestAsk,
        mid: bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null,
        spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
        fetchedAt: Math.floor(Date.now() / 1000)
    };
}

/**
 * Walk the book: how much USD can be bought (asks) or sold (bids) before the price moves past `maxMove`.
 * Returns fillable shares, average price and worst price. This is the "slippage map" primitive.
 */
export function walkBook(levels: BookLevel[], side: 'BUY' | 'SELL', usd: number): { shares: number; avgPrice: number; worstPrice: number; filled: number } {
    let remaining = usd, shares = 0, cost = 0, worst = 0;
    for (const l of levels) {
        const levelUsd = l.price * l.size;
        const take = Math.min(remaining, levelUsd);
        if (take <= 0) break;
        const sh = take / l.price;
        shares += sh; cost += take; worst = l.price; remaining -= take;
        if (remaining <= 1e-9) break;
    }
    return { shares, avgPrice: shares ? cost / shares : 0, worstPrice: worst, filled: cost };
}

export function depthWithin(levels: BookLevel[], side: 'BUY' | 'SELL', cents: number): number {
    if (!levels.length) return 0;
    const ref = levels[0].price;
    const lim = side === 'BUY' ? ref + cents / 100 : ref - cents / 100;
    return levels.filter(l => (side === 'BUY' ? l.price <= lim : l.price >= lim)).reduce((s, l) => s + l.price * l.size, 0);
}

export interface PricePoint { t: number; p: number }

/** Price history for a CLOB token. interval: '1h','6h','1d','1w','1m','max'; fidelity = minutes per point. */
export async function priceHistory(tokenId: string, interval: '1h' | '6h' | '1d' | '1w' | '1m' | 'max' = '1w', fidelity = 60): Promise<PricePoint[]> {
    const d = await getJson<{ history?: { t: number; p: number }[] }>(`${BASE}/prices-history${qs({ market: tokenId, interval, fidelity })}`, { ttlMs: 60_000 });
    return (d.history ?? []).map(h => ({ t: num(h.t), p: num(h.p) }));
}

export interface ClobMarket {
    conditionId: string;
    question: string;
    closed: boolean;
    active: boolean;
    acceptingOrders: boolean;
    endDateIso: string;
    tokens: { tokenId: string; outcome: string; price: number; winner: boolean }[];
    winnerIndex: number | null;
    resolved: boolean;
    negRisk: boolean;
    minTickSize: number;
}

/** Market by conditionId, including the declared winner once resolved. */
export async function clobMarket(conditionId: string, ttlMs = 10 * 60_000): Promise<ClobMarket | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = await getJson<any>(`${BASE}/markets/${conditionId}`, { ttlMs });
        const tokens = (m.tokens ?? []).map((t: { token_id?: unknown; outcome?: unknown; price?: unknown; winner?: unknown }) => ({ tokenId: str(t.token_id), outcome: str(t.outcome), price: num(t.price), winner: t.winner === true }));
        const wi = tokens.findIndex((t: { winner: boolean }) => t.winner);
        return {
            conditionId: str(m.condition_id).toLowerCase(), question: str(m.question), closed: Boolean(m.closed), active: Boolean(m.active),
            acceptingOrders: Boolean(m.accepting_orders), endDateIso: str(m.end_date_iso), tokens,
            winnerIndex: wi >= 0 ? wi : null, resolved: Boolean(m.closed) && wi >= 0, negRisk: Boolean(m.neg_risk), minTickSize: num(m.minimum_tick_size, 0.01)
        };
    } catch { return null; }
}

export async function midpoint(tokenId: string): Promise<number | null> {
    try { const d = await getJson<{ mid?: unknown }>(`${BASE}/midpoint${qs({ token_id: tokenId })}`); return d.mid === undefined ? null : num(d.mid); } catch { return null; }
}
