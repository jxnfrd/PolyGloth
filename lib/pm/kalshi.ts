import { getJson, qs, num, str } from './http';

/** Kalshi public (unauthenticated) endpoints. Trading requires an API key and is out of scope. */
const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

export interface KalshiMarket {
    ticker: string;
    eventTicker: string;
    seriesTicker: string;
    title: string;
    subtitle: string;
    status: string;
    yesBid: number;   // dollars 0..1
    yesAsk: number;
    noBid: number;
    noAsk: number;
    lastPrice: number;
    volume: number;
    volume24h: number;
    openInterest: number;
    closeTime: string;
    expirationTime: string;
    rulesPrimary: string;
    result: string;     // 'yes' | 'no' | '' until settled
    canCloseEarly: boolean;
}

export interface KalshiTrade {
    tradeId: string;
    ticker: string;
    count: number;
    yesPrice: number;
    noPrice: number;
    takerSide: 'yes' | 'no';
    createdTime: string;
    isBlockTrade: boolean;
}

function cents(v: unknown): number { return num(v) / 100; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMarket(m: any): KalshiMarket {
    // Newer API returns *_dollars strings; older returns cents ints. Prefer dollars when present.
    const pick = (dollars: unknown, c: unknown) => (dollars !== undefined && dollars !== null ? num(dollars) : cents(c));
    return {
        ticker: str(m.ticker), eventTicker: str(m.event_ticker), seriesTicker: str(m.series_ticker),
        title: str(m.title), subtitle: str(m.subtitle || m.yes_sub_title), status: str(m.status),
        yesBid: pick(m.yes_bid_dollars, m.yes_bid), yesAsk: pick(m.yes_ask_dollars, m.yes_ask),
        noBid: pick(m.no_bid_dollars, m.no_bid), noAsk: pick(m.no_ask_dollars, m.no_ask),
        lastPrice: pick(m.last_price_dollars, m.last_price),
        volume: num(m.volume_fp ?? m.volume), volume24h: num(m.volume_24h_fp ?? m.volume_24h), openInterest: num(m.open_interest_fp ?? m.open_interest),
        closeTime: str(m.close_time), expirationTime: str(m.expiration_time), rulesPrimary: str(m.rules_primary),
        result: str(m.result), canCloseEarly: Boolean(m.can_close_early)
    };
}

export async function kalshiMarkets(p: { limit?: number; cursor?: string; status?: 'open' | 'closed' | 'settled'; seriesTicker?: string; eventTicker?: string } = {}): Promise<{ markets: KalshiMarket[]; cursor: string }> {
    const d = await getJson<{ markets?: unknown[]; cursor?: string }>(`${BASE}/markets${qs({ limit: p.limit ?? 200, cursor: p.cursor, status: p.status ?? 'open', series_ticker: p.seriesTicker, event_ticker: p.eventTicker })}`);
    return { markets: (d.markets ?? []).map(toMarket), cursor: str(d.cursor) };
}

export interface KalshiEvent { eventTicker: string; seriesTicker: string; title: string; subTitle: string; category: string; mutuallyExclusive: boolean; markets: KalshiMarket[] }

/**
 * All open markets via the EVENTS endpoint with nested markets.
 * Audit 2026-09-25 (Phase 4 builder): `/markets?status=open` is dominated by auto-generated multivariate
 * parlays (series KXMVE*, titles "yes A,yes B,…"), so paging it never reaches real markets. The events
 * endpoint lists real events; parlay series are skipped here.
 */
export async function allOpenKalshiEvents(maxPages = 400, log?: (m: string) => void): Promise<KalshiEvent[]> {
    const out: KalshiEvent[] = []; let cursor = '';
    for (let i = 0; i < maxPages; i++) {
        const d = await getJson<{ events?: unknown[]; cursor?: string }>(`${BASE}/events${qs({ limit: 200, cursor: cursor || undefined, status: 'open', with_nested_markets: true })}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const e of (d.events ?? []) as any[]) {
            if (/^KXMVE/i.test(str(e.series_ticker))) continue;
            out.push({ eventTicker: str(e.event_ticker), seriesTicker: str(e.series_ticker), title: str(e.title), subTitle: str(e.sub_title), category: str(e.category), mutuallyExclusive: Boolean(e.mutually_exclusive), markets: (e.markets ?? []).map(toMarket) });
        }
        if (log && i % 25 === 0) log(`kalshi events page ${i}: ${out.length} events`);
        if (!d.cursor || !(d.events ?? []).length) break;
        cursor = str(d.cursor);
    }
    return out;
}

/** All open, non-parlay markets (flattened from events). */
export async function allOpenKalshiMarkets(maxPages = 400, log?: (m: string) => void): Promise<KalshiMarket[]> {
    const evs = await allOpenKalshiEvents(maxPages, log);
    return evs.flatMap(e => e.markets.map(m => ({ ...m, eventTicker: m.eventTicker || e.eventTicker, seriesTicker: m.seriesTicker || e.seriesTicker, title: m.title || e.title })));
}

export async function kalshiTrades(p: { ticker?: string; limit?: number; cursor?: string; minTs?: number } = {}): Promise<{ trades: KalshiTrade[]; cursor: string }> {
    const d = await getJson<{ trades?: unknown[]; cursor?: string }>(`${BASE}/markets/trades${qs({ ticker: p.ticker, limit: p.limit ?? 200, cursor: p.cursor, min_ts: p.minTs })}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trades = (d.trades ?? []).map((t: any) => ({
        tradeId: str(t.trade_id), ticker: str(t.ticker), count: num(t.count_fp ?? t.count),
        yesPrice: t.yes_price_dollars !== undefined ? num(t.yes_price_dollars) : cents(t.yes_price),
        noPrice: t.no_price_dollars !== undefined ? num(t.no_price_dollars) : cents(t.no_price),
        takerSide: str(t.taker_side) === 'no' ? 'no' as const : 'yes' as const,
        createdTime: str(t.created_time), isBlockTrade: Boolean(t.is_block_trade)
    }));
    return { trades, cursor: str(d.cursor) };
}
