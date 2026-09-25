/**
 * Comment / social sentiment analytics on Polymarket event comments (spec §6).
 * Comments are wallet-linked (comments.proxy_wallet), so every stance can be checked
 * against what the commenter actually holds.
 */
import { openDb, stmt, all, get, run, transaction, now } from '../pm/db';
import { ingestComments } from '../pm/ingest';
import { walletPositions } from '../pm/data-api';

export function ensureSchema() {
    openDb().exec(`
    CREATE TABLE IF NOT EXISTS commenter_positions (
      wallet TEXT NOT NULL, condition_id TEXT NOT NULL, outcome_index INTEGER NOT NULL,
      size REAL, avg_price REAL, cur_price REAL, ts INTEGER NOT NULL,
      PRIMARY KEY (wallet, condition_id, outcome_index)
    );`);
}

// ---------------------------------------------------------------------------
// Lexicon (tunable)
// ---------------------------------------------------------------------------
export const LEXICON = {
    yes: ['yes', 'will happen', 'will win', 'lock', 'free money', 'easy money', 'guaranteed', 'buying yes', 'bought yes', 'long yes', 'confirmed', 'done deal', 'certain', 'obviously yes', 'yes is'],
    no: ['no', "won't", 'wont', 'never', 'not happening', 'not going to', 'buying no', 'bought no', 'long no', 'fade', 'no chance', 'zero chance', 'obviously no', 'no is'],
    euphoria: ['easy', 'free money', 'lock', 'guaranteed', 'lol', 'lmao', 'moon', 'printing', 'ez'],
    leak: ['hearing that', 'source says', 'sources say', 'just confirmed', 'insider', 'my guy', 'confirmed', 'leaked', 'heard from', 'i know someone'],
    rulesLawyer: ['resolve', 'resolution', 'rules', 'uma', 'dispute', 'technically', 'clarif', 'wording', 'criteria']
};

export type Stance = 'YES' | 'NO' | 'neutral';

export interface StanceResult { stance: Stance; confidence: number; yesHits: number; noHits: number }

const norm = (s: string) => ' ' + s.toLowerCase().replace(/[^a-z0-9$%.' ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

function countHits(text: string, phrases: string[]): number {
    let n = 0;
    for (const p of phrases) {
        const re = new RegExp(`(?<![a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'g');
        n += (text.match(re) || []).length;
    }
    return n;
}

/**
 * Stance from lexicon + outcome names. Outcome names (e.g. candidate names) count as YES for that outcome
 * only when the market is binary Yes/No we treat "outcomes[0]" mentions as YES, "outcomes[1]" mentions as NO.
 * Negations within 3 words flip a hit ("not yes" → NO). Confidence = |yes−no| / (yes+no), 0 when no hits.
 */
/** Portuguese/Spanish function words: in those languages a bare "no"/"não" is not a NO stance ("no" = "in the" in PT). */
const NON_EN_RE = /\b(n[aã]o|que|para|pra|com|vai|ele|ela|eu|isso|está|esta|muito|mais|pero|también|nada|los|las|del|una|sí|eleição|turno|segundo|governo|presidente|um|uma|dos|das|se|j[aá]|quem|vota|fico|salve|mesmo|ainda|agora|porque|tudo|nunca|sempre)\b/gi;
export function looksNonEnglish(body: string): boolean { return ((body.toLowerCase().match(NON_EN_RE) || []).length) >= 2; }

export function classifyStance(body: string, outcomes: string[] = []): StanceResult {
    const t = norm(body);
    const nonEn = looksNonEnglish(body);
    // In non-English text only multi-word phrases and outcome names count; bare yes/no are ambiguous.
    let yes = countHits(t, nonEn ? LEXICON.yes.filter(p => p.includes(' ')) : LEXICON.yes);
    let no = countHits(t, nonEn ? LEXICON.no.filter(p => p.includes(' ')) : LEXICON.no);
    const isBinary = outcomes.length === 2 && /^yes$/i.test(outcomes[0]) && /^no$/i.test(outcomes[1]);
    if (!isBinary && outcomes.length >= 2) {
        const o0 = outcomes[0].toLowerCase(), o1 = outcomes[1].toLowerCase();
        if (o0.length >= 3 && t.includes(' ' + o0 + ' ')) yes += 1;
        if (o1.length >= 3 && t.includes(' ' + o1 + ' ')) no += 1;
    }
    // simple negation handling: "not yes", "no way yes" etc.
    const negYes = (t.match(/\b(not|no way|never|don'?t think)\s+(\w+\s+){0,2}yes\b/g) || []).length;
    const negNo = (t.match(/\b(not|no way|never|don'?t think)\s+(\w+\s+){0,2}no\b/g) || []).length;
    yes -= negYes; no += negYes; no -= negNo; yes += negNo;
    yes = Math.max(0, yes); no = Math.max(0, no);
    const total = yes + no;
    if (total === 0) return { stance: 'neutral', confidence: 0, yesHits: yes, noHits: no };
    const conf = Math.abs(yes - no) / total;
    return { stance: yes === no ? 'neutral' : yes > no ? 'YES' : 'NO', confidence: conf, yesHits: yes, noHits: no };
}

export function isEuphoric(body: string): boolean {
    const t = norm(body);
    const caps = body.length >= 8 && body.replace(/[^A-Za-z]/g, '').length >= 6 && body === body.toUpperCase();
    return countHits(t, LEXICON.euphoria) > 0 || (body.match(/!/g) || []).length >= 2 || caps;
}

export function hasLeakPhrase(body: string): string[] {
    const t = norm(body);
    return LEXICON.leak.filter(p => countHits(t, [p]) > 0);
}

export function isRulesLawyer(body: string): boolean { return countHits(norm(body), LEXICON.rulesLawyer) > 0; }

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------
interface CommentRow { id: string; event_id: string; body: string; proxy_wallet: string; name: string; created_ts: number; reaction_count: number }
interface EventRow { id: string; slug: string; title: string; neg_risk: number }
interface MarketRow { condition_id: string; question: string; outcomes: string; yes_price: number | null; event_id: string }

export async function refreshComments(eventIds: string[], max = 500, log: (m: string) => void = () => {}): Promise<number> {
    ensureSchema();
    let n = 0;
    for (const id of eventIds) n += await ingestComments(id, max, log);
    return n;
}

export function eventMarkets(eventId: string): MarketRow[] {
    return all<MarketRow>('SELECT condition_id, question, outcomes, yes_price, event_id FROM markets WHERE event_id = ?', eventId);
}

export function eventIdBySlug(slug: string): string | null {
    return get<{ id: string }>('SELECT id FROM events WHERE slug = ?', slug)?.id ?? null;
}

/** Net position per (wallet, condition, outcome) from ingested trades. */
export function netPositionsFromTrades(wallet: string, conditionIds: string[]): { condition_id: string; outcome_index: number; shares: number; avg_price: number }[] {
    if (!conditionIds.length) return [];
    const ph = conditionIds.map(() => '?').join(',');
    const rows = all<{ condition_id: string; outcome_index: number; side: string; size: number; usdc: number }>(
        `SELECT condition_id, outcome_index, side, size, usdc FROM trades WHERE wallet = ? AND condition_id IN (${ph})`, wallet, ...conditionIds);
    const m = new Map<string, { condition_id: string; outcome_index: number; shares: number; cost: number; bought: number }>();
    for (const r of rows) {
        const k = `${r.condition_id}|${r.outcome_index}`;
        const cur = m.get(k) ?? { condition_id: r.condition_id, outcome_index: r.outcome_index, shares: 0, cost: 0, bought: 0 };
        if (r.side === 'BUY') { cur.shares += r.size; cur.cost += r.usdc; cur.bought += r.size; } else cur.shares -= r.size;
        m.set(k, cur);
    }
    return Array.from(m.values()).filter(p => Math.abs(p.shares) > 1e-6).map(p => ({ condition_id: p.condition_id, outcome_index: p.outcome_index, shares: p.shares, avg_price: p.bought ? p.cost / p.bought : 0 }));
}

/**
 * Commenter position overlay. Uses ingested trades when the wallet has any; otherwise fetches live
 * positions (data-api) for up to `fetchLimit` unknown wallets and caches them in commenter_positions.
 */
export async function commenterPositions(eventId: string, fetchLimit = 20, cacheSec = 6 * 3600): Promise<Map<string, { condition_id: string; outcome_index: number; shares: number; avg_price: number }[]>> {
    ensureSchema();
    const mkts = eventMarkets(eventId);
    const cids = mkts.map(m => m.condition_id);
    const wallets = all<{ w: string }>("SELECT DISTINCT proxy_wallet w FROM comments WHERE event_id = ? AND proxy_wallet != ''", eventId).map(r => r.w);
    const out = new Map<string, { condition_id: string; outcome_index: number; shares: number; avg_price: number }[]>();
    let fetched = 0;
    for (const w of wallets) {
        const hasTrades = get<{ n: number }>('SELECT COUNT(*) n FROM trades WHERE wallet = ?', w)?.n ?? 0;
        if (hasTrades > 0) { out.set(w, netPositionsFromTrades(w, cids)); continue; }
        const cached = all<{ condition_id: string; outcome_index: number; size: number; avg_price: number; ts: number }>(
            `SELECT condition_id, outcome_index, size, avg_price, ts FROM commenter_positions WHERE wallet = ? AND condition_id IN (${cids.map(() => '?').join(',') || "''"})`, w, ...cids);
        if (cached.length && now() - Math.max(...cached.map(c => c.ts)) < cacheSec) {
            out.set(w, cached.map(c => ({ condition_id: c.condition_id, outcome_index: c.outcome_index, shares: c.size, avg_price: c.avg_price })));
            continue;
        }
        if (fetched >= fetchLimit) continue;
        fetched++;
        try {
            const pos = await walletPositions(w, 500);
            const ts = now();
            transaction(() => {
                const ins = stmt('INSERT OR REPLACE INTO commenter_positions(wallet, condition_id, outcome_index, size, avg_price, cur_price, ts) VALUES (?,?,?,?,?,?,?)');
                for (const p of pos) if (cids.includes(p.conditionId)) ins.run(w, p.conditionId, p.outcomeIndex, p.size, p.avgPrice, p.curPrice, ts);
                // mark "checked" even when empty so we don't refetch every run
                if (!pos.some(p => cids.includes(p.conditionId)) && cids[0]) ins.run(w, cids[0], -1, 0, 0, 0, ts);
            });
            out.set(w, pos.filter(p => cids.includes(p.conditionId)).map(p => ({ condition_id: p.conditionId, outcome_index: p.outcomeIndex, shares: p.size, avg_price: p.avgPrice })));
        } catch { /* skip wallet */ }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------
export interface CommentAnalysis {
    id: string; wallet: string; name: string; ts: number; body: string; stance: Stance; confidence: number;
    heldSide: 'YES' | 'NO' | 'none' | 'mixed'; divergent: boolean; euphoric: boolean; leak: string[]; rulesLawyer: boolean;
}

function heldSideFor(positions: { condition_id: string; outcome_index: number; shares: number }[] | undefined, binaryCid: string | null): 'YES' | 'NO' | 'none' | 'mixed' {
    if (!positions || !positions.length) return 'none';
    const rel = binaryCid ? positions.filter(p => p.condition_id === binaryCid && p.outcome_index >= 0) : positions.filter(p => p.outcome_index >= 0);
    if (!rel.length) return 'none';
    const yes = rel.filter(p => p.outcome_index === 0 && p.shares > 0).length, no = rel.filter(p => p.outcome_index === 1 && p.shares > 0).length;
    if (yes && no) return 'mixed';
    return yes ? 'YES' : no ? 'NO' : 'none';
}

/** Analyse all stored comments for an event. For multi-market events stance maps to the event's first market. */
export async function analyzeEvent(eventId: string, opts: { fetchPositions?: boolean; positionFetchLimit?: number } = {}): Promise<{ event: EventRow | undefined; comments: CommentAnalysis[]; market: MarketRow | undefined }> {
    ensureSchema();
    const event = get<EventRow>('SELECT id, slug, title, neg_risk FROM events WHERE id = ?', eventId);
    const mkts = eventMarkets(eventId);
    const market = mkts[0];
    const outcomes: string[] = market ? (JSON.parse(market.outcomes || '[]') as string[]) : [];
    const rows = all<CommentRow>('SELECT id, event_id, body, proxy_wallet, name, created_ts, reaction_count FROM comments WHERE event_id = ? ORDER BY created_ts DESC', eventId);
    const positions = opts.fetchPositions === false ? new Map() : await commenterPositions(eventId, opts.positionFetchLimit ?? 20);
    const binaryCid = mkts.length === 1 ? mkts[0].condition_id : null;
    const comments: CommentAnalysis[] = rows.map(r => {
        const s = classifyStance(r.body, outcomes);
        const held = heldSideFor(positions.get(r.proxy_wallet), binaryCid);
        const divergent = s.stance !== 'neutral' && s.confidence >= 0.5 && (held === 'YES' || held === 'NO') && held !== s.stance;
        return { id: r.id, wallet: r.proxy_wallet, name: r.name, ts: r.created_ts, body: r.body, stance: s.stance, confidence: s.confidence, heldSide: held, divergent, euphoric: isEuphoric(r.body), leak: hasLeakPhrase(r.body), rulesLawyer: isRulesLawyer(r.body) };
    });
    return { event, comments, market };
}

/** Comments/hour in the last hour vs trailing 7-day hourly mean → z-score. */
export function velocitySpike(eventId: string, at = now()): { lastHour: number; meanHourly: number; sdHourly: number; z: number } {
    const lastHour = get<{ n: number }>('SELECT COUNT(*) n FROM comments WHERE event_id = ? AND created_ts > ? AND created_ts <= ?', eventId, at - 3600, at)?.n ?? 0;
    const buckets = all<{ h: number; n: number }>('SELECT (created_ts / 3600) h, COUNT(*) n FROM comments WHERE event_id = ? AND created_ts > ? AND created_ts <= ? GROUP BY h', eventId, at - 7 * 86400, at - 3600);
    const counts = new Array<number>(168).fill(0);
    const base = Math.floor((at - 3600) / 3600) - 167;
    for (const b of buckets) { const i = b.h - base; if (i >= 0 && i < 168) counts[i] = b.n; }
    const mean = counts.reduce((a, b) => a + b, 0) / 168;
    const sd = Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / 168);
    const z = sd > 0 ? (lastHour - mean) / sd : (lastHour > 0 && mean === 0 ? lastHour : 0);
    return { lastHour, meanHourly: mean, sdHourly: sd, z };
}

/** Reaction-weighted YES share among stance-bearing comments in the window, minus the market price. */
export function sentimentPriceGap(comments: CommentAnalysis[], yesPrice: number | null, windowSec = 86400, at = now(), reactions: Map<string, number> = new Map()): { yesShare: number | null; n: number; gap: number | null } {
    const recent = comments.filter(c => c.ts > at - windowSec && c.stance !== 'neutral');
    if (!recent.length) return { yesShare: null, n: 0, gap: null };
    let wy = 0, wt = 0;
    for (const c of recent) { const w = (reactions.get(c.id) ?? 0) + 1; wt += w; if (c.stance === 'YES') wy += w; }
    const share = wy / wt;
    return { yesShare: share, n: recent.length, gap: yesPrice === null ? null : share - yesPrice };
}

/** Contrarian mood index 0..1 = one-sidedness × euphoria share. */
export function contrarianMood(comments: CommentAnalysis[], windowSec = 86400, at = now()): { index: number; oneSided: number; euphoria: number; side: Stance; n: number } {
    const recent = comments.filter(c => c.ts > at - windowSec);
    const stanced = recent.filter(c => c.stance !== 'neutral');
    if (!stanced.length) return { index: 0, oneSided: 0, euphoria: 0, side: 'neutral', n: 0 };
    const yesShare = stanced.filter(c => c.stance === 'YES').length / stanced.length;
    const oneSided = Math.abs(yesShare - 0.5) * 2;
    const euphoria = recent.filter(c => c.euphoric).length / recent.length;
    return { index: oneSided * euphoria, oneSided, euphoria, side: yesShare >= 0.5 ? 'YES' : 'NO', n: stanced.length };
}

function tokens(s: string): Set<string> { return new Set(norm(s).split(' ').filter(w => w.length > 2)); }
function jaccard(a: Set<string>, b: Set<string>): number { let inter = 0; a.forEach(x => { if (b.has(x)) inter++; }); const uni = a.size + b.size - inter; return uni ? inter / uni : 0; }

/** ≥3 distinct wallets posting near-identical bodies (Jaccard ≥ 0.8) within 6h. */
export function shillClusters(comments: { id: string; wallet: string; ts: number; body: string }[], minWallets = 3, windowSec = 6 * 3600, minJaccard = 0.8): { bodies: string[]; wallets: string[]; ids: string[] }[] {
    const cs = comments.filter(c => tokens(c.body).size >= 4).sort((a, b) => a.ts - b.ts);
    const used = new Set<string>(); const clusters: { bodies: string[]; wallets: string[]; ids: string[] }[] = [];
    for (let i = 0; i < cs.length; i++) {
        if (used.has(cs[i].id)) continue;
        const ti = tokens(cs[i].body); const members = [cs[i]];
        for (let j = i + 1; j < cs.length && cs[j].ts - cs[i].ts <= windowSec; j++) {
            if (used.has(cs[j].id)) continue;
            if (jaccard(ti, tokens(cs[j].body)) >= minJaccard) members.push(cs[j]);
        }
        const wallets = Array.from(new Set(members.map(m => m.wallet)));
        if (wallets.length >= minWallets) { members.forEach(m => used.add(m.id)); clusters.push({ bodies: members.map(m => m.body), wallets, ids: members.map(m => m.id) }); }
    }
    return clusters;
}

/** Comments by wallets with a positive, significant calibrated ROI in wallet_scores (empty if Phase 2 has not run). */
export function smartCommenterFeed(eventId: string, limit = 50): (CommentRow & { calibrated_roi: number; p_value: number })[] {
    try {
        return all<CommentRow & { calibrated_roi: number; p_value: number }>(
            `SELECT c.id, c.event_id, c.body, c.proxy_wallet, c.name, c.created_ts, c.reaction_count, w.calibrated_roi, w.p_value
             FROM comments c JOIN wallet_scores w ON w.wallet = c.proxy_wallet AND w.category = 'all' AND w.window_days = 0
             WHERE c.event_id = ? AND w.calibrated_roi > 0 AND w.p_value < 0.1 ORDER BY c.created_ts DESC LIMIT ?`, eventId, limit);
    } catch { return []; }
}

export function walletScore(wallet: string): { calibrated_roi: number; p_value: number; n_resolved: number } | null {
    try { return get<{ calibrated_roi: number; p_value: number; n_resolved: number }>(`SELECT calibrated_roi, p_value, n_resolved FROM wallet_scores WHERE wallet = ? AND category = 'all' AND window_days = 0`, wallet) ?? null; } catch { return null; }
}

export interface EventSentimentReport {
    eventId: string; slug: string; title: string; yesPrice: number | null; nComments: number;
    stanceCounts: Record<Stance, number>; gap: ReturnType<typeof sentimentPriceGap>; velocity: ReturnType<typeof velocitySpike>;
    mood: ReturnType<typeof contrarianMood>; divergent: CommentAnalysis[]; leaks: CommentAnalysis[]; rulesLawyers: number; shills: ReturnType<typeof shillClusters>;
    smart: ReturnType<typeof smartCommenterFeed>;
}

/** Full report for one event; writes signals rows. */
export async function eventSentiment(eventId: string, opts: { fetchPositions?: boolean; positionFetchLimit?: number; writeSignals?: boolean } = {}): Promise<EventSentimentReport> {
    const { event, comments, market } = await analyzeEvent(eventId, opts);
    const reactions = new Map(all<{ id: string; reaction_count: number }>('SELECT id, reaction_count FROM comments WHERE event_id = ?', eventId).map(r => [r.id, r.reaction_count] as [string, number]));
    const yesPrice = market?.yes_price ?? null;
    const gap = sentimentPriceGap(comments, yesPrice, 86400, now(), reactions);
    const velocity = velocitySpike(eventId);
    const mood = contrarianMood(comments);
    const divergent = comments.filter(c => c.divergent);
    const leaks = comments.filter(c => c.leak.length);
    const shills = shillClusters(comments.map(c => ({ id: c.id, wallet: c.wallet, ts: c.ts, body: c.body })));
    const stanceCounts: Record<Stance, number> = { YES: 0, NO: 0, neutral: 0 };
    for (const c of comments) stanceCounts[c.stance]++;
    const report: EventSentimentReport = { eventId, slug: event?.slug ?? '', title: event?.title ?? '', yesPrice, nComments: comments.length, stanceCounts, gap, velocity, mood, divergent, leaks, rulesLawyers: comments.filter(c => c.rulesLawyer).length, shills, smart: smartCommenterFeed(eventId) };
    if (opts.writeSignals !== false) writeSentimentSignals(report, market?.condition_id ?? null);
    return report;
}

function writeSentimentSignals(r: EventSentimentReport, cid: string | null) {
    const t = now();
    const ins = (type: string, score: number, payload: unknown, wallet: string | null = null) =>
        run('INSERT INTO signals(type, ts, wallet, condition_id, score, payload) VALUES (?,?,?,?,?,?)', type, t, wallet, cid, score, JSON.stringify({ eventId: r.eventId, slug: r.slug, ...(payload as object) }));
    transaction(() => {
        // de-dupe: skip if same type for this event written in the last hour
        const recent = new Set(all<{ type: string }>(`SELECT DISTINCT type FROM signals WHERE ts > ? AND payload LIKE ?`, t - 3600, `%"eventId":"${r.eventId}"%`).map(x => x.type));
        if (r.velocity.z >= 3 && !recent.has('comment_spike')) ins('comment_spike', Math.min(100, r.velocity.z * 20), { lastHour: r.velocity.lastHour, meanHourly: r.velocity.meanHourly, z: r.velocity.z });
        if (!recent.has('talk_wallet_divergence')) for (const d of r.divergent.slice(0, 20)) ins('talk_wallet_divergence', Math.round(d.confidence * 100), { commentId: d.id, stance: d.stance, held: d.heldSide, body: d.body.slice(0, 280) }, d.wallet);
        if (!recent.has('leak_phrase')) for (const l of r.leaks.slice(0, 20)) ins('leak_phrase', 50, { commentId: l.id, phrases: l.leak, body: l.body.slice(0, 280), walletScore: walletScore(l.wallet) }, l.wallet);
        if (!recent.has('shill_cluster')) for (const s of r.shills) ins('shill_cluster', Math.min(100, s.wallets.length * 25), { wallets: s.wallets, sample: s.bodies[0].slice(0, 200), n: s.ids.length });
        if (r.mood.index >= 0.5 && !recent.has('contrarian_mood')) ins('contrarian_mood', Math.round(r.mood.index * 100), { side: r.mood.side, oneSided: r.mood.oneSided, euphoria: r.mood.euphoria, n: r.mood.n });
        if (r.gap.gap !== null && Math.abs(r.gap.gap) >= 0.25 && r.gap.n >= 10 && !recent.has('sentiment_price_gap')) ins('sentiment_price_gap', Math.round(Math.abs(r.gap.gap) * 100), { yesShare: r.gap.yesShare, yesPrice: r.yesPrice, n: r.gap.n });
    });
}
