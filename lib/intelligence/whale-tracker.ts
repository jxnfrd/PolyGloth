import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Whale Tracker v2 (2026-09-25 rebuild).
 *
 * The v1 tracker scraped polymarket.com HTML with cheerio, could not find volume,
 * direction, size or price, and wrote placeholders (YES / $500 / 0.50) for every
 * <a href="/event/..."> on the profile page, which are mostly the site's trending
 * sidebar, not the trader's positions. 12.5k such rows were written to production.
 *
 * v2 uses Polymarket's public data API (no key, JSON):
 *   GET https://data-api.polymarket.com/v1/leaderboard?window=month&orderBy=pnl&limit=N
 *   GET https://data-api.polymarket.com/positions?user=<proxyWallet>&sizeThreshold=..
 */

const DATA_API = 'https://data-api.polymarket.com';

export interface LeaderboardTrader {
    proxyWallet: string;
    userName: string;
    rank: number;
    vol: number;
    pnl: number;
}

export interface WhalePosition {
    conditionId: string;
    eventSlug: string;
    marketSlug: string;
    title: string;
    outcome: string;
    outcomeIndex: number;
    size: number;          // shares
    avgPrice: number;      // 0..1
    curPrice: number;      // 0..1
    initialValue: number;  // USD paid
    currentValue: number;  // USD now
    cashPnl: number;
    endDate: string | null;
}

export interface WhaleScanOptions {
    /** How many leaderboard traders to pull. */
    poolSize?: number;
    /** How many of the pool to scan this run (random sample to spread load). */
    scanCount?: number;
    /** 'pnl' (default) or 'vol'. */
    orderBy?: 'pnl' | 'vol';
    /** 'day' | 'week' | 'month' (default) | 'all'. */
    window?: 'day' | 'week' | 'month' | 'all';
    /** Ignore positions below this USD value. Default 1000. */
    minPositionUsd?: number;
    /** Skip the 5-minute / 15-minute crypto up-or-down scalp markets. Default true. */
    excludeScalps?: boolean;
    /** Skip sports / esports markets. Default false (whales are mostly sports bettors). */
    excludeSports?: boolean;
}

const SCALP_RE = /updown|up-or-down|up or down/i;
const SPORTS_RE = /^(atp|wta|nfl|nba|mlb|nhl|epl|ucl|cs2|lol|dota2?|val|mma|ufc|ncaa|cfb|cbb|wnba|mls|bra\d?|col\d?|conl|unl|el\d|gtm|hkt|sau|uae|qat)-/i;

export class WhaleTracker {
    private supabase: SupabaseClient;
    private log: (msg: string) => void;

    constructor(opts: { supabase?: SupabaseClient; log?: (msg: string) => void } = {}) {
        this.log = opts.log ?? ((m) => console.log(m));
        if (opts.supabase) {
            this.supabase = opts.supabase;
        } else {
            if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
                throw new Error('WhaleTracker: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
            }
            this.supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        }
    }

    private delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

    /** true once supabase/migrations/20260925_audit_v3.sql has been applied; false = write legacy columns only. */
    private v3Schema: boolean | null = null;
    private async hasV3Schema(): Promise<boolean> {
        if (this.v3Schema !== null) return this.v3Schema;
        const { error } = await this.supabase.from('whale_signals').select('source').limit(1);
        this.v3Schema = !error;
        if (!this.v3Schema) this.log('   ⚠️ v3 columns missing (apply supabase/migrations/20260925_audit_v3.sql). Writing legacy columns only.');
        return this.v3Schema;
    }

    private async getJson(url: string, tries = 3): Promise<unknown> {
        for (let i = 0; i < tries; i++) {
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (res.status === 429) { await this.delay(1500 * (i + 1)); continue; }
            if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
            return res.json();
        }
        throw new Error(`Rate limited after ${tries} tries: ${url}`);
    }

    // ---- Public API -------------------------------------------------------

    async fetchLeaderboard(limit = 20, orderBy: 'pnl' | 'vol' = 'pnl', window: WhaleScanOptions['window'] = 'month'): Promise<LeaderboardTrader[]> {
        const data = await this.getJson(`${DATA_API}/v1/leaderboard?window=${window}&limit=${limit}&orderBy=${orderBy}`);
        if (!Array.isArray(data)) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return data.map((r: any, i: number) => ({
            proxyWallet: String(r.proxyWallet).toLowerCase(),
            userName: String(r.userName || r.proxyWallet),
            rank: Number(r.rank) || i + 1,
            vol: Number(r.vol) || 0,
            pnl: Number(r.pnl) || 0
        }));
    }

    async fetchOpenPositions(proxyWallet: string, minUsd = 1000): Promise<WhalePosition[]> {
        const out: WhalePosition[] = [];
        for (let offset = 0; offset < 1500; offset += 500) {
            const page = await this.getJson(`${DATA_API}/positions?user=${proxyWallet}&limit=500&offset=${offset}&sizeThreshold=1&sortBy=CURRENT&sortDirection=DESC`);
            if (!Array.isArray(page) || page.length === 0) break;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const p of page as any[]) {
                const cur = Number(p.curPrice);
                const open = cur > 0.01 && cur < 0.99 && !p.redeemable;
                if (!open) continue;
                const pos: WhalePosition = {
                    conditionId: String(p.conditionId),
                    eventSlug: String(p.eventSlug || p.slug || ''),
                    marketSlug: String(p.slug || ''),
                    title: String(p.title || ''),
                    outcome: String(p.outcome || ''),
                    outcomeIndex: Number(p.outcomeIndex) || 0,
                    size: Number(p.size) || 0,
                    avgPrice: Number(p.avgPrice) || 0,
                    curPrice: cur,
                    initialValue: Number(p.initialValue) || 0,
                    currentValue: Number(p.currentValue) || 0,
                    cashPnl: Number(p.cashPnl) || 0,
                    endDate: p.endDate ? String(p.endDate) : null
                };
                if (pos.currentValue >= minUsd) out.push(pos);
            }
            // sorted by CURRENT desc, so once a page's smallest is under the threshold we can stop
            const last = page[page.length - 1];
            if (page.length < 500 || Number(last.currentValue) < minUsd) break;
            await this.delay(250);
        }
        return out;
    }

    /** Scan leaderboard whales and upsert their open positions as whale_signals. */
    async updateTopTraders(scanCount = 5, poolSize = 20, opts: WhaleScanOptions = {}): Promise<{ scanned: number; signals: number }> {
        const { orderBy = 'pnl', window = 'month', minPositionUsd = 1000, excludeScalps = true, excludeSports = false } = opts;
        this.log(`🐳 Whale scan: pool top ${poolSize} by ${orderBy}/${window}, scanning ${scanCount}, min $${minPositionUsd}`);

        const pool = await this.fetchLeaderboard(poolSize, orderBy, window);
        const targets = [...pool].sort(() => 0.5 - Math.random()).slice(0, scanCount);
        let signals = 0;

        for (const trader of targets) {
            const traderId = await this.upsertTrader(trader);
            if (!traderId) continue;
            try {
                let positions = await this.fetchOpenPositions(trader.proxyWallet, minPositionUsd);
                if (excludeScalps) positions = positions.filter(p => !SCALP_RE.test(p.eventSlug) && !SCALP_RE.test(p.title));
                if (excludeSports) positions = positions.filter(p => !SPORTS_RE.test(p.eventSlug));
                // Market makers hold BOTH sides of a market (e.g. $3M YES + $3M NO). That is inventory, not a view: skip hedged pairs.
                const sides = new Map<string, Set<number>>();
                for (const p of positions) { if (!sides.has(p.conditionId)) sides.set(p.conditionId, new Set()); sides.get(p.conditionId)!.add(p.outcomeIndex); }
                const hedged = positions.filter(p => (sides.get(p.conditionId)?.size ?? 0) > 1).length;
                positions = positions.filter(p => (sides.get(p.conditionId)?.size ?? 0) === 1);
                if (hedged) this.log(`   ${trader.userName.slice(0, 20)}: skipped ${hedged} hedged (both-sides) positions`);
                this.log(`   ${trader.userName.slice(0, 20)} (#${trader.rank}, pnl $${Math.round(trader.pnl)}): ${positions.length} open positions ≥ $${minPositionUsd}`);
                signals += await this.upsertSignals(positions, traderId, trader.rank);
            } catch (err) {
                this.log(`   ❌ ${trader.userName}: ${(err as Error).message}`);
            }
            await this.delay(400);
        }
        this.log(`✅ Whale scan complete: ${targets.length} traders, ${signals} signals upserted`);
        return { scanned: targets.length, signals };
    }

    // ---- DB ---------------------------------------------------------------

    private async upsertTrader(t: LeaderboardTrader): Promise<string | null> {
        const { data, error } = await this.supabase
            .from('tracked_traders')
            .upsert({
                polymarket_user_id: t.proxyWallet,
                display_name: t.userName,
                leaderboard_rank: t.rank,
                total_volume: t.vol,
                total_profit: t.pnl,
                last_updated: new Date().toISOString()
            }, { onConflict: 'polymarket_user_id' })
            .select('id')
            .single();
        if (error) { this.log(`   ❌ upsert trader: ${error.message}`); return null; }
        return data.id;
    }

    static strength(pos: WhalePosition, rank: number): 'high' | 'medium' | 'low' {
        if (pos.currentValue >= 25_000 || (rank <= 5 && pos.currentValue >= 10_000)) return 'high';
        if (pos.currentValue >= 5_000 || rank <= 10) return 'medium';
        return 'low';
    }

    private async upsertSignals(positions: WhalePosition[], traderId: string, rank: number): Promise<number> {
        let n = 0;
        const v3 = await this.hasV3Schema();
        for (const pos of positions) {
            const binaryYesNo = /^(yes|no)$/i.test(pos.outcome);
            const now = new Date().toISOString();
            // Legacy shape (pre-migration DB). market_id starting with 0x marks a v2 row; v1 placeholder rows used slugs.
            const legacy = {
                trader_id: traderId,
                market_id: `${pos.conditionId}:${pos.outcomeIndex}`,
                market_slug: pos.eventSlug,
                market_question: binaryYesNo ? pos.title : `${pos.title} → ${pos.outcome}`,
                trader_action: binaryYesNo ? pos.outcome.toUpperCase() : (pos.outcomeIndex === 0 ? 'YES' : 'NO'),
                position_size_usd: Math.round(pos.initialValue * 100) / 100,
                average_buy_price: pos.avgPrice,
                potential_payout: Math.round(pos.size * 100) / 100,
                discovered_at: now,
                signal_strength: WhaleTracker.strength(pos, rank)
            };
            if (!v3) {
                const { error } = await this.supabase.from('whale_signals').upsert(legacy, { onConflict: 'market_id,trader_id' });
                if (error) this.log(`   ❌ upsert signal ${pos.eventSlug}: ${error.message}`); else n++;
                continue;
            }
            const row = {
                trader_id: traderId,
                market_id: `${pos.conditionId}:${pos.outcomeIndex}`,
                market_slug: pos.eventSlug,
                market_question: pos.title,
                // Legacy column has CHECK (YES|NO|SCALP). For multi-outcome markets outcome_label carries the truth.
                trader_action: binaryYesNo ? pos.outcome.toUpperCase() : (pos.outcomeIndex === 0 ? 'YES' : 'NO'),
                outcome_label: pos.outcome,
                condition_id: pos.conditionId,
                position_size_usd: Math.round(pos.initialValue * 100) / 100,
                current_value_usd: Math.round(pos.currentValue * 100) / 100,
                average_buy_price: pos.avgPrice,
                current_price: pos.curPrice,
                shares: pos.size,
                pnl_usd: Math.round(pos.cashPnl * 100) / 100,
                potential_payout: Math.round(pos.size * 100) / 100, // 1 USDC per winning share
                market_end_date: pos.endDate,
                signal_strength: WhaleTracker.strength(pos, rank),
                source: 'data-api',
                last_seen_at: new Date().toISOString()
            };
            const { error } = await this.supabase.from('whale_signals').upsert(row, { onConflict: 'market_id,trader_id' });
            if (error) this.log(`   ❌ upsert signal ${pos.eventSlug}: ${error.message}`);
            else n++;
        }
        return n;
    }
}
