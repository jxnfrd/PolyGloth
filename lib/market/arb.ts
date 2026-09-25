/**
 * Arbitrage and cross-venue tools (spec §8).
 * Types: multi-outcome sum (neg-risk events), ladder/threshold, logical (earlier ⊂ later), cross-venue vs Kalshi.
 * Every edge is gross unless a fee/cost model is applied via `applyCosts`.
 */
import { openDb, all, get, run, now, transaction } from '../pm/db';
import { orderBook, walkBook } from '../pm/clob';
import { getJson, qs, num, str } from '../pm/http';
import { toTs } from '../pm/db';

export function ensureSchema() { openDb(); }

interface MarketRow { condition_id: string; event_id: string; event_slug: string; question: string; description: string; outcomes: string; yes_price: number | null; best_bid: number | null; best_ask: number | null; end_ts: number | null; clob_token_ids: string; active: number }
interface EventRow { id: string; slug: string; title: string; neg_risk: number; end_ts: number | null }

const MCOLS = 'condition_id, event_id, event_slug, question, description, outcomes, yes_price, best_bid, best_ask, end_ts, clob_token_ids, active';

/** Ask price for YES / NO of a binary market. NO ask ≈ 1 − YES bid. Falls back to yes_price when the book is unknown. */
export function askYes(m: { yes_price: number | null; best_ask: number | null }): number | null { return m.best_ask ?? m.yes_price; }
export function askNo(m: { yes_price: number | null; best_bid: number | null }): number | null { return m.best_bid !== null && m.best_bid !== undefined ? 1 - m.best_bid : (m.yes_price === null ? null : 1 - m.yes_price); }

export function annualize(edge: number, daysToEnd: number): number { return edge * (365 / Math.max(0.5, daysToEnd)); }

// ---------------------------------------------------------------------------
// Multi-outcome sum (pure)
// ---------------------------------------------------------------------------
export interface SumArb { kind: 'all_yes' | 'all_no'; sumAsk: number; edge: number; edgePct: number; legs: { condition_id: string; question: string; ask: number }[] }

/** Buying every YES costs Σask; pays exactly 1 → edge = 1 − Σask. Buying every NO costs Σ(noAsk); pays N−1 → edge = (N−1) − Σ. */
/**
 * Legs must have a real two-sided book (best_bid AND best_ask). Gamma reports 0.5/0.5 with no bids for placeholder
 * outcomes ("Will A win…", active=0), which would otherwise fake a huge all-NO edge. Any leg without a book → no arb.
 */
export function multiOutcomeSum(markets: { condition_id: string; question: string; yes_price: number | null; best_ask: number | null; best_bid: number | null; active?: number | boolean }[]): SumArb[] {
    const out: SumArb[] = [];
    if (markets.some(m => m.best_ask === null || m.best_ask === undefined || m.best_bid === null || m.best_bid === undefined || m.active === 0 || m.active === false)) return out;
    const yes = markets.map(m => ({ condition_id: m.condition_id, question: m.question, ask: askYes(m) })).filter(l => l.ask !== null) as { condition_id: string; question: string; ask: number }[];
    if (yes.length === markets.length && yes.length >= 2) {
        const s = yes.reduce((a, l) => a + l.ask, 0);
        if (s < 1) out.push({ kind: 'all_yes', sumAsk: s, edge: 1 - s, edgePct: (1 - s) / s, legs: yes });
    }
    const no = markets.map(m => ({ condition_id: m.condition_id, question: m.question, ask: askNo(m) })).filter(l => l.ask !== null) as { condition_id: string; question: string; ask: number }[];
    if (no.length === markets.length && no.length >= 2) {
        const s = no.reduce((a, l) => a + l.ask, 0);
        const payout = no.length - 1;
        if (s < payout) out.push({ kind: 'all_no', sumAsk: s, edge: payout - s, edgePct: (payout - s) / s, legs: no });
    }
    return out;
}

export interface SumArbHit extends SumArb { event_id: string; event_slug: string; title: string; daysToEnd: number; annualized: number; maxSizeUsd?: number }

export async function scanMultiOutcome(opts: { live?: boolean; minEdge?: number; limit?: number } = {}): Promise<SumArbHit[]> {
    const t = now();
    const events = all<EventRow>('SELECT id, slug, title, neg_risk, end_ts FROM events WHERE neg_risk = 1 AND closed = 0 ORDER BY volume24hr DESC LIMIT ?', opts.limit ?? 300);
    const out: SumArbHit[] = [];
    for (const ev of events) {
        const ms = all<MarketRow>(`SELECT ${MCOLS} FROM markets WHERE event_id = ? AND closed = 0`, ev.id);
        if (ms.length < 2) continue;
        for (const a of multiOutcomeSum(ms)) {
            if (a.edge < (opts.minEdge ?? 0.005)) continue;
            const days = ev.end_ts ? (ev.end_ts - t) / 86400 : 30;
            const hit: SumArbHit = { ...a, event_id: ev.id, event_slug: ev.slug, title: ev.title, daysToEnd: Math.round(days * 10) / 10, annualized: annualize(a.edgePct, days) };
            if (opts.live) hit.maxSizeUsd = await liveMaxSize(ms, a.kind);
            out.push(hit);
        }
    }
    transaction(() => { for (const h of out) run('INSERT INTO signals(type, ts, score, payload) VALUES (?,?,?,?)', 'arb_multi_outcome', t, Math.min(100, h.edgePct * 1000), JSON.stringify({ event_slug: h.event_slug, kind: h.kind, sumAsk: h.sumAsk, edge: h.edge, legs: h.legs.length, maxSizeUsd: h.maxSizeUsd })); });
    return out.sort((a, b) => b.edgePct - a.edgePct);
}

/** Max USD per leg such that every leg fills within its quoted ask + 1¢ (live books). Returns the binding (smallest) leg. */
async function liveMaxSize(ms: MarketRow[], kind: 'all_yes' | 'all_no'): Promise<number> {
    let minUsd = Infinity;
    for (const m of ms) {
        const toks = JSON.parse(m.clob_token_ids || '[]') as string[];
        const tok = kind === 'all_yes' ? toks[0] : toks[1];
        if (!tok) return 0;
        try {
            const b = await orderBook(tok);
            const best = b.bestAsk ?? 1;
            let lo = 0, hi = b.asks.reduce((s, l) => s + l.price * l.size, 0);
            for (let i = 0; i < 25; i++) { const mid = (lo + hi) / 2; const w = walkBook(b.asks, 'BUY', mid); if (w.filled >= mid - 1e-6 && w.avgPrice <= best + 0.01) lo = mid; else hi = mid; }
            minUsd = Math.min(minUsd, lo);
        } catch { return 0; }
    }
    return Number.isFinite(minUsd) ? minUsd : 0;
}

// ---------------------------------------------------------------------------
// Ladder / threshold
// ---------------------------------------------------------------------------
export interface LadderLeg { condition_id: string; question: string; threshold: number; direction: 'above' | 'below'; pYes: number; bid?: number; ask?: number }
export interface LadderViolation { event_id: string; lower: LadderLeg; higher: LadderLeg; spread: number }

const THRESH_RE = /(above|over|more than|at least|exceed[s]?|reach(?:es)?|hit[s]?|≥|>=|>|higher than)\s*\$?([\d,]+(?:\.\d+)?)\s*((?:[kKmMbB%](?![a-zA-Z]))?)|(below|under|less than|fewer than|≤|<=|<|lower than)\s*\$?([\d,]+(?:\.\d+)?)\s*((?:[kKmMbB%](?![a-zA-Z]))?)|\$?([\d,]+(?:\.\d+)?)\s*((?:[kKmMbB](?![a-zA-Z]))?)\s*(?:[a-z%]{1,4}\s+)?(or more|or higher|or above|\+)|\$?([\d,]+(?:\.\d+)?)\s*((?:[kKmMbB](?![a-zA-Z]))?)\s*(?:[a-z%]{1,4}\s+)?(or less|or lower|or below|or fewer)/i;

export function parseThreshold(question: string): { threshold: number; direction: 'above' | 'below' } | null {
    // "Over/Under X" totals: outcomes are [Over, Under] so yes_price = P(Over) → treat as an "above" ladder.
    const ou = /over\s*\/\s*under\s*\$?([\d,]+(?:\.\d+)?)|\bo\/u\s*\$?([\d,]+(?:\.\d+)?)/i.exec(question);
    if (ou) return { threshold: parseFloat((ou[1] || ou[2]).replace(/,/g, '')), direction: 'above' };
    const m = THRESH_RE.exec(question);
    if (!m) return null;
    const mult = (s: string) => ({ k: 1e3, m: 1e6, b: 1e9 } as Record<string, number>)[(s || '').toLowerCase()] ?? 1;
    if (m[2]) return { threshold: parseFloat(m[2].replace(/,/g, '')) * mult(m[3]), direction: 'above' };
    if (m[5]) return { threshold: parseFloat(m[5].replace(/,/g, '')) * mult(m[6]), direction: 'below' };
    if (m[7]) return { threshold: parseFloat(m[7].replace(/,/g, '')) * mult(m[8]), direction: 'above' };
    if (m[10]) return { threshold: parseFloat(m[10].replace(/,/g, '')) * mult(m[11]), direction: 'below' };
    return null;
}

/** Question with ONLY the threshold number blanked ("Map 1 O/U 17.5" → "map 1 o/u #"), so different maps/games stay separate ladders. */
export function ladderStem(question: string): string {
    const q = question.toLowerCase();
    const ou = /(over\s*\/\s*under|\bo\/u)\s*\$?[\d,]+(?:\.\d+)?/i.exec(q);
    const m = ou ?? THRESH_RE.exec(q);
    const stem = m ? q.slice(0, m.index) + q.slice(m.index, m.index + m[0].length).replace(/\$?[\d,]+(?:\.\d+)?\s*[kmb%]?/, '#') + q.slice(m.index + m[0].length) : q;
    return stem.replace(/\s+/g, ' ').trim();
}

/** Within one event: P(above X) ≥ P(above Y) for X < Y; P(below X) ≤ P(below Y) for X < Y. */
export function ladderViolations(markets: { event_id: string; condition_id: string; question: string; yes_price: number | null; best_bid?: number | null; best_ask?: number | null }[], minSpread = 0.01): LadderViolation[] {
    const byEvent = new Map<string, LadderLeg[]>();
    for (const m of markets) {
        const th = parseThreshold(m.question);
        if (!th || m.yes_price === null) continue;
        // skip "between X and Y" bucket markets: they are not monotone
        if (/between|from .* to|-\s*\$?\d/i.test(m.question)) continue;
        // Same ladder = same event AND same question once the threshold number is removed ("Map 1 O/U 17.5" ≠ "Map 3 O/U 19.5").
        const key = `${m.event_id}|${ladderStem(m.question)}`;
        // Executable prices: a violation only exists if you can SELL the over-priced leg at its bid and BUY the under-priced leg at its ask.
        const bid = m.best_bid ?? m.yes_price, ask = m.best_ask ?? m.yes_price;
        if (ask - bid > 0.2) continue; // dead book (e.g. 2¢/98¢ placeholder quotes)
        const arr = byEvent.get(key) ?? []; arr.push({ condition_id: m.condition_id, question: m.question, threshold: th.threshold, direction: th.direction, pYes: m.yes_price, bid, ask }); byEvent.set(key, arr);
    }
    const out: LadderViolation[] = [];
    Array.from(byEvent.entries()).forEach(([key, legs]) => {
        const event_id = key.split('|')[0];
        for (const dir of ['above', 'below'] as const) {
            const ls = legs.filter(l => l.direction === dir).sort((a, b) => a.threshold - b.threshold);
            for (let i = 0; i < ls.length - 1; i++) {
                const lo = ls[i], hi = ls[i + 1];
                if (lo.threshold === hi.threshold) continue;
                // 'above': P(>X) ≥ P(>Y) for X<Y. Violation = buy hi YES at ask, sell lo YES at bid, pocket the difference.
                // Violation when the leg that must be cheaper trades richer: sell it at its bid, buy the other at its ask.
                const bad = dir === 'above' ? (hi.bid ?? hi.pYes) - (lo.ask ?? lo.pYes) : (lo.bid ?? lo.pYes) - (hi.ask ?? hi.pYes); // positive = executable violation
                if (bad >= minSpread) out.push({ event_id, lower: lo, higher: hi, spread: bad });
            }
        }
    });
    return out.sort((a, b) => b.spread - a.spread);
}

export function scanLadders(minSpread = 0.01): (LadderViolation & { event_slug: string })[] {
    // Legs need a live two-sided book: Gamma placeholder outcomes sit at 50¢ with no book and fake 45pp "violations".
    const ms = all<MarketRow>(`SELECT ${MCOLS} FROM markets WHERE closed = 0 AND active = 1 AND event_id != '' AND yes_price IS NOT NULL AND best_bid IS NOT NULL AND best_ask IS NOT NULL AND best_bid > 0 AND best_ask < 1`);
    const slugs = new Map(ms.map(m => [m.event_id, m.event_slug] as [string, string]));
    const v = ladderViolations(ms, minSpread).map(x => ({ ...x, event_slug: slugs.get(x.event_id) ?? '' }));
    transaction(() => { for (const x of v) run('INSERT INTO signals(type, ts, condition_id, score, payload) VALUES (?,?,?,?,?)', 'arb_ladder', now(), x.higher.condition_id, Math.min(100, x.spread * 500), JSON.stringify({ event_slug: x.event_slug, lower: x.lower, higher: x.higher, spread: x.spread })); });
    return v;
}

// ---------------------------------------------------------------------------
// Logical / correlated pairs (conservative rules)
// ---------------------------------------------------------------------------
export interface LogicalViolation { rule: string; narrower: { condition_id: string; question: string; pYes: number }; broader: { condition_id: string; question: string; pYes: number }; spread: number }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function deadlineOf(q: string): number | null {
    // Day must not be followed by another digit, otherwise "July 2027" parses as day 20 of the current year (found 2026-09-25).
    const m = /\b(?:by|before)\s+(?:(january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:(\d{1,2})(?!\d),?\s*)?(\d{4})?|(end of|eoy)\s*(\d{4})?|(\d{4}))/i.exec(q);
    if (!m) return null;
    if (m[1]) { const yr = m[3] ? +m[3] : new Date().getUTCFullYear(); const mo = MONTHS.indexOf(m[1].toLowerCase()); const day = m[2] ? +m[2] : 28; return Date.UTC(yr, mo, day) / 1000; }
    if (m[4]) { const yr = m[5] ? +m[5] : new Date().getUTCFullYear(); return Date.UTC(yr, 11, 31) / 1000; }
    if (m[6]) return Date.UTC(+m[6], 11, 31) / 1000;
    return null;
}
function stem(q: string): string { return q.toLowerCase().replace(/\b(?:by|before)\s+.*$/i, '').replace(/\b(will|the|a|an|in|on|of|to|be|is|does|do|before|by|end|eoy)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

/**
 * Rules: (1) same stem + "by <earlier>" vs "by <later>": P(earlier) ≤ P(later).
 *        (2) same entity: "<X> win(s) the ... nomination" ≥ "<X> win(s) the ... presidency/presidential election".
 */
export function logicalViolations(markets: { condition_id: string; question: string; yes_price: number | null }[], minSpread = 0.01): LogicalViolation[] {
    const out: LogicalViolation[] = [];
    const ms = markets.filter(m => m.yes_price !== null) as { condition_id: string; question: string; yes_price: number }[];
    // rule 1
    const byStem = new Map<string, { m: typeof ms[number]; dl: number }[]>();
    for (const m of ms) { const dl = deadlineOf(m.question); if (dl === null) continue; const s = stem(m.question); if (s.length < 6) continue; const a = byStem.get(s) ?? []; a.push({ m, dl }); byStem.set(s, a); }
    Array.from(byStem.values()).forEach(arr => {
        arr.sort((a, b) => a.dl - b.dl);
        for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
            if (arr[i].dl === arr[j].dl) continue;
            const spread = arr[i].m.yes_price - arr[j].m.yes_price;
            if (spread >= minSpread) out.push({ rule: 'earlier_deadline_le_later', narrower: { condition_id: arr[i].m.condition_id, question: arr[i].m.question, pYes: arr[i].m.yes_price }, broader: { condition_id: arr[j].m.condition_id, question: arr[j].m.question, pYes: arr[j].m.yes_price }, spread });
        }
    });
    // rule 2
    const nom = ms.filter(m => /\bnomination\b|\bnominee\b/i.test(m.question)), pres = ms.filter(m => /presidential election|\bpresidency\b|win the (\d{4} )?(us |u\.s\. )?presiden/i.test(m.question) && !/nomination|nominee/i.test(m.question));
    for (const n of nom) {
        const who = /will\s+(.+?)\s+(win|be)\b/i.exec(n.question)?.[1]?.toLowerCase();
        if (!who || who.length < 4) continue;
        for (const p of pres) {
            if (!p.question.toLowerCase().includes(who)) continue;
            const spread = p.yes_price - n.yes_price; // presidency cannot exceed nomination
            if (spread >= minSpread) out.push({ rule: 'presidency_le_nomination', narrower: { condition_id: p.condition_id, question: p.question, pYes: p.yes_price }, broader: { condition_id: n.condition_id, question: n.question, pYes: n.yes_price }, spread });
        }
    }
    return out.sort((a, b) => b.spread - a.spread);
}

export function scanLogical(minSpread = 0.01): LogicalViolation[] {
    const ms = all<MarketRow>(`SELECT ${MCOLS} FROM markets WHERE closed = 0 AND active = 1 AND yes_price IS NOT NULL AND best_bid IS NOT NULL AND best_ask IS NOT NULL AND best_bid > 0 AND best_ask < 1`);
    const v = logicalViolations(ms, minSpread);
    transaction(() => { for (const x of v) run('INSERT INTO signals(type, ts, condition_id, score, payload) VALUES (?,?,?,?,?)', 'arb_logical', now(), x.narrower.condition_id, Math.min(100, x.spread * 500), JSON.stringify(x)); });
    return v;
}

// ---------------------------------------------------------------------------
// Cross-venue: Kalshi ↔ Polymarket
// ---------------------------------------------------------------------------
export function kalshiFee(contracts: number, p: number): number { return Math.ceil(0.07 * contracts * p * (1 - p) * 100 - 1e-9) / 100; }

const STOP = new Set(['will', 'the', 'a', 'an', 'of', 'to', 'be', 'in', 'on', 'at', 'by', 'or', 'and', 'for', 'is', 'vs', 'v', 'does', 'do', 'than', 'this', 'that', 'before', 'after', 'yes', 'no', 'market', 'question']);
export function titleTokens(s: string): Set<string> {
    return new Set(s.toLowerCase().replace(/[^a-z0-9$%. ]/g, ' ').split(/\s+/).map(w => w.replace(/^\$/, '').replace(/,/g, '')).filter(w => w.length >= 3 && !STOP.has(w)));
}
/** Symmetric Jaccard. (An earlier min-based overlap scored "invade Iran" vs "US-Iran meeting" at 100%.) */
export function tokenOverlap(a: Set<string>, b: Set<string>): number { let inter = 0; a.forEach(x => { if (b.has(x)) inter++; }); const union = a.size + b.size - inter; return union ? inter / union : 0; }

/** Action/verb stems that define what a market is about; two markets must agree on these to be the same question. */
const ACTION_RE = /\b(win|wins|winner|invade|invasion|meet|meeting|declare|announce|nominat\w*|resign|out|cut|cuts|raise|hike|above|below|over|under|control|acquire|sign|pass|approve|ban|ceasefire|strike|visit|release|launch|impeach|indict|convict|pardon|deal|elect\w*|candidacy|ticket|running mate|vice)\b/gi;
export function actionTokens(s: string): Set<string> { return new Set((s.toLowerCase().match(ACTION_RE) || []).map(w => w.replace(/s$/, '').replace(/nominat\w*/, 'nominat').replace(/elect\w*/, 'elect'))); }

export interface VenueMatch { pm: { condition_id: string; question: string; yes_price: number | null; best_ask: number | null; best_bid: number | null; end_ts: number | null; description: string }; kalshi: { ticker: string; title: string; subtitle: string; yes_ask: number; yes_bid: number; no_ask: number; no_bid: number; close_ts: number | null; rules: string }; confidence: number; overlap: number; dayDiff: number | null }

/** Match by normalized title tokens (≥ minOverlap of the shorter token set) and close date within ±2 days. */
export function matchVenues(pm: VenueMatch['pm'][], ks: VenueMatch['kalshi'][], minOverlap = 0.5): VenueMatch[] {
    const out: VenueMatch[] = [];
    const kt = ks.map(k => ({ k, t: titleTokens(`${k.title} ${k.subtitle}`), a: actionTokens(`${k.title} ${k.subtitle}`) }));
    for (const p of pm) {
        const pt = titleTokens(p.question), pa = actionTokens(p.question);
        if (pt.size < 2) continue;
        let best: VenueMatch | null = null;
        for (const { k, t, a } of kt) {
            const ov = tokenOverlap(pt, t);
            if (ov < minOverlap) continue;
            // action words must agree: every action in the shorter set must appear in the other (win ≠ declare candidacy, invade ≠ meet)
            const [small, big] = pa.size <= a.size ? [pa, a] : [a, pa];
            let agree = true; small.forEach(x => { if (!big.has(x)) agree = false; });
            if (!agree || (pa.size > 0) !== (a.size > 0)) continue;
            const dayDiff = p.end_ts && k.close_ts ? Math.abs(p.end_ts - k.close_ts) / 86400 : null;
            if (dayDiff !== null && dayDiff > 1) continue;
            // Numeric thresholds must agree. A Polymarket threshold with no parsable Kalshi threshold is NOT a match
            // (2026-09-25: "$81,000 or above" was unparsed and matched every BTC strike → fake 96% arbs).
            const tp = parseThreshold(p.question), tk = parseThreshold(`${k.title} ${k.subtitle}`);
            if ((tp && !tk) || (!tp && tk)) continue;
            if (tp && tk && (tp.threshold !== tk.threshold || tp.direction !== tk.direction)) continue;
            // Every number with ≥2 digits (years aside) must appear on BOTH sides as a whole token:
            // "foldable iPhone" ≠ "iPhone 18", "September 26" ≠ "Sep 25", strike $90,000 ≠ $81,000.
            const numTokens = (txt: string) => new Set((txt.replace(/,(?=\d{3})/g, '').match(/\d+(?:\.\d+)?/g) || []).map(x => x.replace(/\.(0+|99)$/, '')).filter(x => x.length >= 2 && !/^(19|20)\d\d$/.test(x)));
            const np = numTokens(p.question), nk = numTokens(`${k.title} ${k.subtitle}`);
            let numsAgree = true; np.forEach(x => { if (!nk.has(x)) numsAgree = false; }); nk.forEach(x => { if (!np.has(x)) numsAgree = false; });
            if (!numsAgree) continue;
            const confidence = Math.min(1, ov * (dayDiff === null ? 0.8 : 1) * (tp && tk ? 1.1 : 1));
            if (!best || confidence > best.confidence) best = { pm: p, kalshi: k, confidence, overlap: ov, dayDiff };
        }
        if (best) out.push(best);
    }
    return out.sort((a, b) => b.confidence - a.confidence);
}

export interface CrossVenueArb { match: VenueMatch; leg: 'buy_yes_pm_buy_no_kalshi' | 'buy_no_pm_buy_yes_kalshi'; cost: number; feePerContract: number; edge: number; edgePct: number; daysToEnd: number; annualized: number }

/** YES_pm_ask + NO_kalshi_ask (+fee) < 1, or NO_pm_ask + YES_kalshi_ask (+fee) < 1. Fee is Kalshi's per-contract taker fee. */
export function crossVenueArbs(matches: VenueMatch[], minEdge = 0.005): CrossVenueArb[] {
    const out: CrossVenueArb[] = []; const t = now();
    for (const m of matches) {
        const yPm = askYes(m.pm), nPm = askNo(m.pm);
        const days = m.pm.end_ts ? (m.pm.end_ts - t) / 86400 : (m.kalshi.close_ts ? (m.kalshi.close_ts - t) / 86400 : 30);
        if (yPm !== null && m.kalshi.no_ask > 0) {
            const fee = kalshiFee(1, m.kalshi.no_ask); const cost = yPm + m.kalshi.no_ask + fee;
            if (1 - cost >= minEdge) out.push({ match: m, leg: 'buy_yes_pm_buy_no_kalshi', cost, feePerContract: fee, edge: 1 - cost, edgePct: (1 - cost) / cost, daysToEnd: days, annualized: annualize((1 - cost) / cost, days) });
        }
        if (nPm !== null && m.kalshi.yes_ask > 0) {
            const fee = kalshiFee(1, m.kalshi.yes_ask); const cost = nPm + m.kalshi.yes_ask + fee;
            if (1 - cost >= minEdge) out.push({ match: m, leg: 'buy_no_pm_buy_yes_kalshi', cost, feePerContract: fee, edge: 1 - cost, edgePct: (1 - cost) / cost, daysToEnd: days, annualized: annualize((1 - cost) / cost, days) });
        }
    }
    return out.sort((a, b) => b.edgePct - a.edgePct);
}

/**
 * Kalshi's /markets?status=open feed is dominated by auto-generated multivariate parlays (series KXMVE*, titles "yes A,yes B,…"),
 * which exhaust lib/pm/kalshi.ts's page cap before any real market appears. This pulls real markets through /events
 * (nested markets), skips parlays, and upserts into kalshi_markets. Sports are kept (Kalshi ↔ Polymarket sports arbs exist).
 */
export async function ingestKalshiEvents(maxPages = 25, log: (m: string) => void = () => {}): Promise<number> {
    let cursor = ''; let n = 0;
    for (let i = 0; i < maxPages; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = await getJson<any>(`https://api.elections.kalshi.com/trade-api/v2/events${qs({ status: 'open', limit: 200, with_nested_markets: true, cursor: cursor || undefined })}`);
        const events: any[] = Array.isArray(d.events) ? d.events : [];
        transaction(() => {
            for (const e of events) {
                if (/^KXMVE/i.test(str(e.series_ticker))) continue;
                for (const m of (e.markets ?? []) as any[]) {
                    if (/^yes /i.test(str(m.title))) continue;
                    const pick = (dol: unknown, c: unknown) => (dol !== undefined && dol !== null ? num(dol) : num(c) / 100);
                    run(`INSERT INTO kalshi_markets(ticker, event_ticker, series_ticker, title, subtitle, status, yes_bid, yes_ask, no_bid, no_ask, last_price, volume, volume24h, open_interest, close_ts, rules, result, updated_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(ticker) DO UPDATE SET title=excluded.title, subtitle=excluded.subtitle, status=excluded.status, yes_bid=excluded.yes_bid, yes_ask=excluded.yes_ask, no_bid=excluded.no_bid, no_ask=excluded.no_ask,
                           last_price=excluded.last_price, volume=excluded.volume, volume24h=excluded.volume24h, open_interest=excluded.open_interest, close_ts=excluded.close_ts, rules=excluded.rules, result=excluded.result, updated_at=excluded.updated_at`,
                        str(m.ticker), str(e.event_ticker), str(e.series_ticker), str(m.title), str(m.yes_sub_title || m.subtitle), str(m.status || 'open'),
                        pick(m.yes_bid_dollars, m.yes_bid), pick(m.yes_ask_dollars, m.yes_ask), pick(m.no_bid_dollars, m.no_bid), pick(m.no_ask_dollars, m.no_ask), pick(m.last_price_dollars, m.last_price),
                        num(m.volume_fp ?? m.volume), num(m.volume_24h_fp ?? m.volume_24h), num(m.open_interest_fp ?? m.open_interest), toTs(str(m.close_time)), str(m.rules_primary), str(m.result), now());
                    n++;
                }
            }
        });
        cursor = str(d.cursor);
        if (!cursor || events.length === 0) break;
    }
    log(`kalshi events: ${n} real markets upserted`);
    return n;
}

export function loadVenueInputs(limitPm = 1500): { pm: VenueMatch['pm'][]; ks: VenueMatch['kalshi'][] } {
    const pm = all<VenueMatch['pm']>('SELECT condition_id, question, yes_price, best_ask, best_bid, end_ts, description FROM markets WHERE closed = 0 AND is_sports = 0 AND yes_price IS NOT NULL ORDER BY volume24hr DESC LIMIT ?', limitPm);
    const ks = all<VenueMatch['kalshi']>(`SELECT ticker, title, subtitle, yes_ask, yes_bid, no_ask, no_bid, close_ts, rules FROM kalshi_markets WHERE (status = 'open' OR status = 'active') AND ticker NOT LIKE 'KXMVE%' AND title NOT LIKE 'yes %' AND yes_ask > 0 AND yes_ask < 1`);
    return { pm, ks };
}

export function matchReport(minOverlap = 0.5): VenueMatch[] { const { pm, ks } = loadVenueInputs(); return matchVenues(pm, ks, minOverlap); }

export function scanCrossVenue(minEdge = 0.005, minConfidence = 0.55): CrossVenueArb[] {
    const arbs = crossVenueArbs(matchReport().filter(m => m.confidence >= minConfidence), minEdge);
    transaction(() => { for (const a of arbs) run('INSERT INTO signals(type, ts, condition_id, score, payload) VALUES (?,?,?,?,?)', 'arb_cross_venue', now(), a.match.pm.condition_id, Math.min(100, a.edgePct * 1000), JSON.stringify({ leg: a.leg, ticker: a.match.kalshi.ticker, question: a.match.pm.question, cost: a.cost, edge: a.edge, confidence: a.match.confidence })); });
    return arbs;
}

// ---------------------------------------------------------------------------
// Resolution-rule diff, cost model
// ---------------------------------------------------------------------------
const FACT_RE = /https?:\/\/[^\s)]+|\b\d{1,2}:\d{2}\s*(?:am|pm)?\s*(?:et|est|edt|utc|gmt|pt)?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b|\$?\d[\d,]*(?:\.\d+)?%?[kmb]?\b|\b(?:according to|per|source|official|announc\w+)\b[^.]{0,60}/gi;

export function ruleDiff(pmDescription: string, kalshiRules: string): { pmOnly: string[]; kalshiOnly: string[]; common: string[] } {
    const facts = (s: string) => Array.from(new Set((s.match(FACT_RE) || []).map(x => x.trim().toLowerCase().replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?/g, '$1').replace(/\s+/g, ' ')).filter(x => x.length >= 2)));
    const a = facts(pmDescription), b = facts(kalshiRules), sb = new Set(b), sa = new Set(a);
    return { pmOnly: a.filter(x => !sb.has(x)), kalshiOnly: b.filter(x => !sa.has(x)), common: a.filter(x => sb.has(x)) };
}

export async function ruleDiffLlm(pmDescription: string, kalshiRules: string): Promise<unknown> {
    const { askJson } = await import('../intelligence/llm');
    const { data } = await askJson(`Two prediction markets claim to cover the same event. List every way they could resolve DIFFERENTLY (source, deadline, time zone, thresholds, edge cases). Return JSON {"differences": string[], "sameResolutionProbability": number}.\nPOLYMARKET RULES: ${pmDescription.slice(0, 2500)}\nKALSHI RULES: ${kalshiRules.slice(0, 2500)}`);
    return data;
}

export interface CostModel { pmWithdrawUsd?: number; kalshiWithdrawUsd?: number; kalshiWithdrawPct?: number; transferDays?: number; slippageBps?: number }

/** Net edge after venue costs for a given notional; edge and result in USD. */
export function applyCosts(grossEdgeUsd: number, notionalUsd: number, daysToEnd: number, c: CostModel = {}): { netUsd: number; netPct: number; annualized: number; costs: number } {
    const costs = (c.pmWithdrawUsd ?? 0) + (c.kalshiWithdrawUsd ?? 0) + notionalUsd * ((c.kalshiWithdrawPct ?? 0) + (c.slippageBps ?? 0) / 10_000);
    const netUsd = grossEdgeUsd - costs;
    const days = daysToEnd + (c.transferDays ?? 0);
    return { netUsd, netPct: notionalUsd ? netUsd / notionalUsd : 0, annualized: notionalUsd ? annualize(netUsd / notionalUsd, days) : 0, costs };
}

export function marketByCondition(cid: string): MarketRow | undefined { return get<MarketRow>(`SELECT ${MCOLS} FROM markets WHERE condition_id = ?`, cid); }
