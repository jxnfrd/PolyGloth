import { getJson, qs, num, str, parseJsonArray } from './http';

const BASE = 'https://gamma-api.polymarket.com';

export interface GammaTag { id: string; label: string; slug: string }

export interface GammaMarket {
    id: string;
    conditionId: string;
    slug: string;
    question: string;
    description: string;
    outcomes: string[];
    outcomePrices: number[];
    clobTokenIds: string[];
    volume: number;
    volume24hr: number;
    liquidity: number;
    startDate: string;
    endDate: string;
    active: boolean;
    closed: boolean;
    negRisk: boolean;
    isSports: boolean;
    resolutionSource: string;
    umaResolutionStatus: string;
    groupItemTitle: string;
    lastTradePrice: number;
    bestBid: number;
    bestAsk: number;
    spread: number;
    oneHourPriceChange: number;
    /** Set when fetched through an event (events endpoint) or events[0] on markets endpoint. */
    eventSlug: string;
    eventId: string;
    tags: string[];
}

export interface GammaEvent {
    id: string;
    slug: string;
    title: string;
    description: string;
    tags: string[];
    seriesTitles: string[];
    negRisk: boolean;
    commentCount: number;
    volume: number;
    volume24hr: number;
    liquidity: number;
    openInterest: number;
    endDate: string;
    active: boolean;
    closed: boolean;
    resolutionSource: string;
    markets: GammaMarket[];
}

export interface GammaComment {
    id: string;
    eventId: string;
    body: string;
    userAddress: string;
    proxyWallet: string;
    name: string;
    createdAt: string;
    reactionCount: number;
    reportCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeMarket(m: any, ev?: { slug?: string; id?: string; tags?: string[] }): GammaMarket {
    const prices = parseJsonArray<string | number>(m.outcomePrices).map(p => num(p));
    const eventObj = m.events?.[0];
    const tags: string[] = ev?.tags ?? (eventObj?.tags ?? m.tags ?? []).map((t: GammaTag | string) => (typeof t === 'string' ? t : t.label));
    return {
        id: str(m.id),
        conditionId: str(m.conditionId).toLowerCase(),
        slug: str(m.slug),
        question: str(m.question),
        description: str(m.description),
        outcomes: parseJsonArray<string>(m.outcomes).map(String),
        outcomePrices: prices,
        clobTokenIds: parseJsonArray<string>(m.clobTokenIds).map(String),
        volume: num(m.volumeNum ?? m.volume),
        volume24hr: num(m.volume24hr),
        liquidity: num(m.liquidityNum ?? m.liquidity),
        startDate: str(m.startDate),
        endDate: str(m.endDate),
        active: Boolean(m.active),
        closed: Boolean(m.closed),
        negRisk: Boolean(m.negRisk),
        isSports: Boolean(m.sportsMarketType || m.gameId || m.gameStartTime),
        resolutionSource: str(m.resolutionSource),
        umaResolutionStatus: str(m.umaResolutionStatus),
        groupItemTitle: str(m.groupItemTitle),
        lastTradePrice: num(m.lastTradePrice),
        bestBid: num(m.bestBid),
        bestAsk: num(m.bestAsk),
        spread: num(m.spread),
        oneHourPriceChange: num(m.oneHourPriceChange),
        eventSlug: ev?.slug ?? str(eventObj?.slug),
        eventId: ev?.id ?? str(eventObj?.id),
        tags
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeEvent(e: any): GammaEvent {
    const tags: string[] = (e.tags ?? []).map((t: GammaTag | string) => (typeof t === 'string' ? t : t.label));
    const ev = { slug: str(e.slug), id: str(e.id), tags };
    return {
        id: ev.id,
        slug: ev.slug,
        title: str(e.title),
        description: str(e.description),
        tags,
        seriesTitles: (e.series ?? []).map((s: { title?: string }) => str(s.title)),
        negRisk: Boolean(e.negRisk),
        commentCount: num(e.commentCount),
        volume: num(e.volume),
        volume24hr: num(e.volume24hr),
        liquidity: num(e.liquidity),
        openInterest: num(e.openInterest),
        endDate: str(e.endDate),
        active: Boolean(e.active),
        closed: Boolean(e.closed),
        resolutionSource: str(e.resolutionSource),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        markets: (e.markets ?? []).map((m: any) => normalizeMarket(m, ev))
    };
}

export interface ListMarketsParams {
    limit?: number; offset?: number; active?: boolean; closed?: boolean;
    order?: 'volume24hr' | 'volumeNum' | 'liquidityNum' | 'endDate' | 'startDate';
    ascending?: boolean; volumeNumMin?: number; liquidityNumMin?: number; endDateMin?: string; endDateMax?: string;
}

export async function listMarkets(p: ListMarketsParams = {}): Promise<GammaMarket[]> {
    const url = `${BASE}/markets${qs({
        limit: p.limit ?? 100, offset: p.offset, active: p.active, closed: p.closed, order: p.order ?? 'volume24hr',
        ascending: p.ascending ?? false, volume_num_min: p.volumeNumMin, liquidity_num_min: p.liquidityNumMin,
        end_date_min: p.endDateMin, end_date_max: p.endDateMax
    })}`;
    const data = await getJson<unknown[]>(url);
    return Array.isArray(data) ? data.map(m => normalizeMarket(m)) : [];
}

export interface ListEventsParams {
    limit?: number; offset?: number; active?: boolean; closed?: boolean;
    order?: 'volume24hr' | 'volume' | 'liquidity' | 'commentCount' | 'endDate' | 'openInterest';
    ascending?: boolean; tagSlug?: string;
}

export async function listEvents(p: ListEventsParams = {}): Promise<GammaEvent[]> {
    const url = `${BASE}/events${qs({
        limit: p.limit ?? 50, offset: p.offset, active: p.active, closed: p.closed, order: p.order ?? 'volume24hr',
        ascending: p.ascending ?? false, tag_slug: p.tagSlug
    })}`;
    const data = await getJson<unknown[]>(url);
    return Array.isArray(data) ? data.map(normalizeEvent) : [];
}

/** Event by slug (the slug that appears in trades/positions as eventSlug). null if unknown. */
export async function getEventBySlug(slug: string, ttlMs = 5 * 60_000): Promise<GammaEvent | null> {
    const data = await getJson<unknown[]>(`${BASE}/events${qs({ slug })}`, { ttlMs });
    return Array.isArray(data) && data.length ? normalizeEvent(data[0]) : null;
}

export async function getEventById(id: string, ttlMs = 5 * 60_000): Promise<GammaEvent | null> {
    try { const data = await getJson(`${BASE}/events/${id}`, { ttlMs }); return data ? normalizeEvent(data) : null; }
    catch { return null; }
}

export async function getMarketById(id: string, ttlMs = 5 * 60_000): Promise<GammaMarket | null> {
    try { const data = await getJson(`${BASE}/markets/${id}`, { ttlMs }); return data ? normalizeMarket(data) : null; }
    catch { return null; }
}

/** Comments on an event, newest first. `proxyWallet` links a commenter to their positions. */
export async function listComments(eventId: string, limit = 100, offset = 0): Promise<GammaComment[]> {
    const url = `${BASE}/comments${qs({ parent_entity_type: 'Event', parent_entity_id: eventId, limit, offset, order: 'createdAt', ascending: false })}`;
    const data = await getJson<unknown[]>(url);
    if (!Array.isArray(data)) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((c: any) => ({
        id: str(c.id),
        eventId: str(c.parentEntityID),
        body: str(c.body),
        userAddress: str(c.userAddress).toLowerCase(),
        proxyWallet: str(c.profile?.proxyWallet).toLowerCase(),
        name: str(c.profile?.name || c.profile?.pseudonym),
        createdAt: str(c.createdAt),
        reactionCount: num(c.reactionCount),
        reportCount: num(c.reportCount)
    }));
}
