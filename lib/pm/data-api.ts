import { getJson, qs, num, str } from './http';

const BASE = 'https://data-api.polymarket.com';

export type LbWindow = 'day' | 'week' | 'month' | 'all';
export type LbOrder = 'pnl' | 'vol';

export interface LeaderboardRow { rank: number; proxyWallet: string; userName: string; vol: number; pnl: number }

export interface Trade {
    proxyWallet: string;
    conditionId: string;
    outcomeIndex: number;
    outcome: string;
    side: 'BUY' | 'SELL';
    size: number;      // shares
    price: number;     // 0..1
    usdc: number;      // size*price
    timestamp: number; // unix seconds
    title: string;
    eventSlug: string;
    marketSlug: string;
    asset: string;     // CLOB token id
    txHash: string;
}

export interface Position {
    proxyWallet: string;
    conditionId: string;
    outcomeIndex: number;
    outcome: string;
    size: number;
    avgPrice: number;
    curPrice: number;
    initialValue: number;
    currentValue: number;
    cashPnl: number;
    realizedPnl: number;
    redeemable: boolean;
    endDate: string;
    title: string;
    eventSlug: string;
    marketSlug: string;
    asset: string;
}

export interface Activity {
    proxyWallet: string;
    type: 'TRADE' | 'REDEEM' | 'SPLIT' | 'MERGE' | 'REWARD' | 'MAKER_REBATE' | 'TAKER_REBATE' | string;
    conditionId: string;
    outcomeIndex: number;
    side: string;
    size: number;
    usdcSize: number;
    price: number;
    timestamp: number;
    title: string;
    eventSlug: string;
    txHash: string;
}

export async function leaderboard(window: LbWindow = 'month', orderBy: LbOrder = 'pnl', limit = 50, offset = 0): Promise<LeaderboardRow[]> {
    const data = await getJson<unknown[]>(`${BASE}/v1/leaderboard${qs({ window, orderBy, limit, offset })}`);
    if (!Array.isArray(data)) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((r: any, i: number) => ({
        rank: num(r.rank, i + 1 + offset),
        proxyWallet: str(r.proxyWallet).toLowerCase(),
        userName: str(r.userName || r.proxyWallet),
        vol: num(r.vol),
        pnl: num(r.pnl)
    }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTrade(t: any): Trade {
    const size = num(t.size), price = num(t.price);
    return {
        proxyWallet: str(t.proxyWallet).toLowerCase(),
        conditionId: str(t.conditionId).toLowerCase(),
        outcomeIndex: num(t.outcomeIndex),
        outcome: str(t.outcome),
        side: str(t.side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
        size, price, usdc: size * price,
        timestamp: num(t.timestamp),
        title: str(t.title),
        eventSlug: str(t.eventSlug),
        marketSlug: str(t.slug),
        asset: str(t.asset),
        txHash: str(t.transactionHash)
    };
}

/** A wallet's trades, newest first. Pages until `max` or exhaustion. */
export async function walletTrades(proxyWallet: string, max = 3000, pageSize = 500): Promise<Trade[]> {
    const out: Trade[] = [];
    for (let offset = 0; offset < max; offset += pageSize) {
        const page = await getJson<unknown[]>(`${BASE}/trades${qs({ user: proxyWallet, limit: Math.min(pageSize, max - offset), offset })}`);
        if (!Array.isArray(page) || page.length === 0) break;
        out.push(...page.map(toTrade));
        if (page.length < pageSize) break;
    }
    return out;
}

/** All wallets' trades in one market (conditionId), newest first. */
export async function marketTrades(conditionId: string, max = 3000, pageSize = 500): Promise<Trade[]> {
    const out: Trade[] = [];
    for (let offset = 0; offset < max; offset += pageSize) {
        const page = await getJson<unknown[]>(`${BASE}/trades${qs({ market: conditionId, limit: Math.min(pageSize, max - offset), offset })}`);
        if (!Array.isArray(page) || page.length === 0) break;
        out.push(...page.map(toTrade));
        if (page.length < pageSize) break;
    }
    return out;
}

/** Current (unredeemed) positions. NOTE: winners get redeemed and disappear; never compute win rates from this. */
export async function walletPositions(proxyWallet: string, max = 1500, sizeThreshold = 1): Promise<Position[]> {
    const out: Position[] = [];
    for (let offset = 0; offset < max; offset += 500) {
        const page = await getJson<unknown[]>(`${BASE}/positions${qs({ user: proxyWallet, limit: 500, offset, sizeThreshold, sortBy: 'CURRENT', sortDirection: 'DESC' })}`);
        if (!Array.isArray(page) || page.length === 0) break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        out.push(...page.map((p: any) => ({
            proxyWallet: str(p.proxyWallet).toLowerCase(),
            conditionId: str(p.conditionId).toLowerCase(),
            outcomeIndex: num(p.outcomeIndex),
            outcome: str(p.outcome),
            size: num(p.size), avgPrice: num(p.avgPrice), curPrice: num(p.curPrice),
            initialValue: num(p.initialValue), currentValue: num(p.currentValue),
            cashPnl: num(p.cashPnl), realizedPnl: num(p.realizedPnl),
            redeemable: Boolean(p.redeemable),
            endDate: str(p.endDate), title: str(p.title), eventSlug: str(p.eventSlug), marketSlug: str(p.slug), asset: str(p.asset)
        })));
        if (page.length < 500) break;
    }
    return out;
}

/** Wallet activity incl. REDEEM (the only public record of realized wins), newest first. */
export async function walletActivity(proxyWallet: string, max = 3000, type?: string): Promise<Activity[]> {
    const out: Activity[] = [];
    for (let offset = 0; offset < max; offset += 500) {
        const page = await getJson<unknown[]>(`${BASE}/activity${qs({ user: proxyWallet, limit: 500, offset, type })}`);
        if (!Array.isArray(page) || page.length === 0) break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        out.push(...page.map((a: any) => ({
            proxyWallet: str(a.proxyWallet).toLowerCase(),
            type: str(a.type),
            conditionId: str(a.conditionId).toLowerCase(),
            outcomeIndex: num(a.outcomeIndex),
            side: str(a.side),
            size: num(a.size), usdcSize: num(a.usdcSize), price: num(a.price),
            timestamp: num(a.timestamp),
            title: str(a.title), eventSlug: str(a.eventSlug), txHash: str(a.transactionHash)
        })));
        if (page.length < 500) break;
    }
    return out;
}
