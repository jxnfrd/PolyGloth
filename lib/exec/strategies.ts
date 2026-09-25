import { kelly } from './risk';
import type { ResolutionRiskFlags } from './risk';

/**
 * Strategies are pure functions over a market snapshot (spec §10). They never touch the DB or the network,
 * so the same code runs in the backtester and in a live/paper loop.
 */

export interface PricePoint { t: number; p: number }

export interface Snapshot {
    conditionId: string;
    ts: number;
    question: string;
    category: string;
    yesPrice: number;            // price of outcomes[0]
    bestBid?: number | null;     // YES side
    bestAsk?: number | null;
    endTs: number | null;
    liquidity: number;
    volume24h: number;           // USD traded in the trailing 24h at `ts` (approximation allowed, see backtest.ts)
    volume1h: number;            // USD traded in the trailing 1h at `ts`
    history: PricePoint[];       // YES price, ascending, up to and including `ts`
    flags: ResolutionRiskFlags;
    negRisk?: boolean;
}

export interface StrategyOrder {
    side: 'BUY';                 // strategies open positions; exits are expressed via the fields below
    outcomeIndex: 0 | 1;         // 0 = YES, 1 = NO
    price: number;               // price of that outcome at decision time
    usd: number;
    reason: string;
    exitAfterSec?: number;       // time stop
    takeProfit?: number;         // outcome price at which to exit
    stopLoss?: number;           // outcome price at which to exit
}

export interface Strategy<P = Record<string, number>> {
    name: string;
    params: P;
    /** Called once per bar per market. `hasOpen` = an open position from this strategy exists in this market. */
    decide(s: Snapshot, hasOpen: boolean): StrategyOrder[];
}

const outcomePrice = (s: Snapshot, idx: 0 | 1) => (idx === 0 ? s.yesPrice : 1 - s.yesPrice);
const daysToEnd = (s: Snapshot) => (s.endTs ? (s.endTs - s.ts) / 86_400 : Infinity);

// ---------------------------------------------------------------------------
// 1. Near-certainty harvester
// ---------------------------------------------------------------------------
export type HarvesterParams = { minPrice: number; maxPrice: number; maxDaysToEnd: number; minLiquidity: number; maxUsd: number }
export const HARVESTER_DEFAULTS: HarvesterParams = { minPrice: 0.97, maxPrice: 0.99, maxDaysToEnd: 7, minLiquidity: 10_000, maxUsd: 500 };

/** Buy the 97–99¢ side within N days of the end when no resolution-risk flag is set. Edge = the last cents; risk = a surprise. */
export function nearCertaintyHarvester(params: Partial<HarvesterParams> = {}): Strategy<HarvesterParams> {
    const p = { ...HARVESTER_DEFAULTS, ...params };
    return {
        name: 'near_certainty', params: p,
        decide(s, hasOpen) {
            if (hasOpen) return [];
            if (daysToEnd(s) > p.maxDaysToEnd || s.liquidity < p.minLiquidity) return [];
            if (s.flags.ambiguousRules || s.flags.umaDisputeHistory || s.flags.thinResolutionSource) return [];
            for (const idx of [0, 1] as const) {
                const px = outcomePrice(s, idx);
                if (px >= p.minPrice && px <= p.maxPrice) return [{ side: 'BUY', outcomeIndex: idx, price: px, usd: p.maxUsd, reason: `harvest ${idx === 0 ? 'YES' : 'NO'} @${px.toFixed(3)} ${daysToEnd(s).toFixed(1)}d to end` }];
            }
            return [];
        }
    };
}

// ---------------------------------------------------------------------------
// 2. Deadline decay ("will X happen by <date>")
// ---------------------------------------------------------------------------
export type DecayParams = { minElapsed: number; margin: number; maxUsd: number; minLiquidity: number }
export const DECAY_DEFAULTS: DecayParams = { minElapsed: 0.5, margin: 0.08, maxUsd: 300, minLiquidity: 10_000 };

/**
 * Constant-hazard model: if the market opened at p0 over horizon T and nothing has happened after fraction X of T,
 * the fair remaining probability is 1 − (1 − p0)^(1 − X). If the current YES price exceeds fair + margin, YES is
 * overpriced → buy NO. Only for "by/before <date>" questions outside sports.
 */
export function fairAfterElapsed(p0: number, elapsed: number): number {
    const x = Math.min(1, Math.max(0, elapsed));
    return 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, p0)), 1 - x);
}

export function deadlineDecay(params: Partial<DecayParams> = {}): Strategy<DecayParams> {
    const p = { ...DECAY_DEFAULTS, ...params };
    return {
        name: 'deadline_decay', params: p,
        decide(s, hasOpen) {
            if (hasOpen || !s.endTs || s.history.length < 2 || s.category === 'sports' || s.liquidity < p.minLiquidity) return [];
            if (!/\b(by|before|until)\b/i.test(s.question)) return [];
            const start = s.history[0].t, p0 = s.history[0].p;
            const elapsed = (s.ts - start) / Math.max(1, s.endTs - start);
            if (elapsed < p.minElapsed || elapsed >= 1) return [];
            const fair = fairAfterElapsed(p0, elapsed);
            if (s.yesPrice > fair + p.margin && s.yesPrice < 0.9) {
                const noPx = 1 - s.yesPrice;
                return [{ side: 'BUY', outcomeIndex: 1, price: noPx, usd: p.maxUsd, reason: `decay: yes ${s.yesPrice.toFixed(2)} > fair ${fair.toFixed(2)} at ${(elapsed * 100).toFixed(0)}% elapsed (p0 ${p0.toFixed(2)})` }];
            }
            return [];
        }
    };
}

// ---------------------------------------------------------------------------
// 3. Thin-move mean reversion
// ---------------------------------------------------------------------------
export type ThinMoveParams = { moveCents: number; windowSec: number; volumeShare: number; fadeFraction: number; maxUsd: number; holdSec: number }
export const THIN_MOVE_DEFAULTS: ThinMoveParams = { moveCents: 8, windowSec: 3600, volumeShare: 0.02, fadeFraction: 0.5, maxUsd: 400, holdSec: 6 * 3600 };

/** Price moved ≥ 8¢ in an hour on < 2 % of 24h volume → fade half of the move with a take-profit at the midpoint. */
export function thinMoveReversion(params: Partial<ThinMoveParams> = {}): Strategy<ThinMoveParams> {
    const p = { ...THIN_MOVE_DEFAULTS, ...params };
    return {
        name: 'thin_move', params: p,
        decide(s, hasOpen) {
            if (hasOpen || s.history.length < 2) return [];
            const cutoff = s.ts - p.windowSec;
            let ref: PricePoint | null = null;
            for (const h of s.history) { if (h.t <= cutoff) ref = h; else break; }
            if (!ref) return [];
            const move = s.yesPrice - ref.p;
            if (Math.abs(move) < p.moveCents / 100) return [];
            if (s.volume24h <= 0 || s.volume1h / s.volume24h >= p.volumeShare) return [];
            if (s.yesPrice <= 0.03 || s.yesPrice >= 0.97) return [];
            const idx: 0 | 1 = move > 0 ? 1 : 0; // fade: price went up → buy NO
            const px = outcomePrice(s, idx);
            const target = ref.p + move / 2; // YES price target = half the move retraced
            const takeProfit = idx === 0 ? target : 1 - target;
            return [{ side: 'BUY', outcomeIndex: idx, price: px, usd: p.maxUsd * p.fadeFraction, exitAfterSec: p.holdSec, takeProfit, reason: `thin move ${(move * 100).toFixed(1)}¢ in ${p.windowSec / 60}m on ${(100 * s.volume1h / s.volume24h).toFixed(2)}% of 24h vol` }];
        }
    };
}

// ---------------------------------------------------------------------------
// 4. External-probability (AI / model) strategy hook
// ---------------------------------------------------------------------------
export type AiProbParams = { minEdge: number; kellyFraction: number; bankroll: number; maxUsd: number }
export const AI_PROB_DEFAULTS: AiProbParams = { minEdge: 0.10, kellyFraction: 0.25, bankroll: 10_000, maxUsd: 500 };

/**
 * Trades the gap between an external probability (LLM, model, polls) and the price, sized by fractional Kelly.
 * `probOf(conditionId, ts)` is supplied by the caller; there is no LLM key in this repo so nothing produces it yet.
 */
export function aiProbabilityStrategy(probOf: (conditionId: string, ts: number) => number | null, params: Partial<AiProbParams> = {}): Strategy<AiProbParams> {
    const p = { ...AI_PROB_DEFAULTS, ...params };
    return {
        name: 'ai_probability', params: p,
        decide(s, hasOpen) {
            if (hasOpen) return [];
            const q = probOf(s.conditionId, s.ts);
            if (q === null || !Number.isFinite(q)) return [];
            const edgeYes = q - s.yesPrice, edgeNo = (1 - q) - (1 - s.yesPrice);
            if (edgeYes >= p.minEdge) { const f = kelly(q, s.yesPrice) * p.kellyFraction; return [{ side: 'BUY', outcomeIndex: 0, price: s.yesPrice, usd: Math.min(p.maxUsd, f * p.bankroll), reason: `ai q=${q.toFixed(2)} vs ${s.yesPrice.toFixed(2)}` }]; }
            if (edgeNo >= p.minEdge) { const f = kelly(1 - q, 1 - s.yesPrice) * p.kellyFraction; return [{ side: 'BUY', outcomeIndex: 1, price: 1 - s.yesPrice, usd: Math.min(p.maxUsd, f * p.bankroll), reason: `ai q=${q.toFixed(2)} vs ${s.yesPrice.toFixed(2)} → NO` }]; }
            return [];
        }
    };
}

export const STRATEGIES: Record<string, () => Strategy> = {
    near_certainty: () => nearCertaintyHarvester(),
    deadline_decay: () => deadlineDecay(),
    thin_move: () => thinMoveReversion()
};
