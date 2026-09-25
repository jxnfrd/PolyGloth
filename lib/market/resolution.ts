/**
 * Resolution rules, oracle and dispute analytics (spec §11).
 * Markets resolve on their written rules, not the headline. These helpers surface where the two differ,
 * where the rules are ambiguous, when rules changed, and where a decided market still trades away from 0/1.
 */
import { createHash } from 'node:crypto';
import { openDb, all, get, run, now, transaction } from '../pm/db';
import { clobMarket } from '../pm/clob';
import { getText } from '../pm/http';

export function ensureSchema() {
    openDb().exec(`
    CREATE TABLE IF NOT EXISTS source_watch (
      condition_id TEXT NOT NULL, url TEXT NOT NULL, last_hash TEXT, last_checked INTEGER, last_changed INTEGER,
      PRIMARY KEY (condition_id, url)
    );`);
}

interface MarketRow { condition_id: string; question: string; description: string; resolution_source: string; uma_status: string; yes_price: number | null; best_bid: number | null; best_ask: number | null; end_ts: number | null; closed: number; resolved: number; winner_index: number | null; category: string; event_slug: string; outcomes: string; volume24hr: number | null }

const MARKET_COLS = 'condition_id, question, description, resolution_source, uma_status, yes_price, best_bid, best_ask, end_ts, closed, resolved, winner_index, category, event_slug, outcomes, volume24hr';

// ---------------------------------------------------------------------------
// Dispute-prone flags → risk score 0–100
// ---------------------------------------------------------------------------
export interface DisputeRisk { score: number; reasons: string[] }

const AMBIGUOUS = [
    [/at (the|its|our) (sole )?discretion/i, 'resolver discretion clause', 25],
    [/credible reporting|consensus of (credible )?(reporting|sources)|(widely|generally) reported/i, 'resolves on "credible reporting" / consensus, no named source', 10],
    [/in (the )?(spirit|intent) of/i, '"spirit of the market" language', 20],
    [/may (be )?(resolve[d]?|settle[d]?) (early|before)/i, 'early-resolution clause', 5],
    [/(other|any) (reliable|official) (source|sources) may be used/i, 'open-ended alternative sources', 15],
    [/unless|except|however|notwithstanding/i, 'carve-outs (unless/except/notwithstanding)', 3],
    [/50\/50|split resolution|resolve (to )?50%/i, '50/50 outcome possible', 15],
    [/announc(e|ed|ement)/i, 'resolves on an announcement, not an occurrence', 5]
] as const;

export function disputeRisk(m: { description: string; resolution_source?: string; question?: string; end_ts?: number | null }): DisputeRisk {
    const reasons: string[] = []; let score = 0;
    const d = m.description || '';
    if (!d.trim()) { return { score: 60, reasons: ['no resolution text'] }; }
    for (const [re, why, pts] of AMBIGUOUS) if (re.test(d)) { reasons.push(why); score += pts; }
    const hasNamedSource = /https?:\/\/|\.gov|\.org|\.com|official (website|site|statement)|according to (the )?[A-Z][a-zA-Z]+/.test(d);
    if (!m.resolution_source && !hasNamedSource) { reasons.push('no named resolution source'); score += 25; }
    const dates = d.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:, \d{4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi) || [];
    if (new Set(dates.map(x => x.toLowerCase())).size >= 3) { reasons.push(`multiple deadlines (${new Set(dates).size} dates)`); score += 10; }
    if (/time zone|ET\b|UTC|GMT|EST|EDT/.test(d) === false && /\bby\b|\bbefore\b|\bon or before\b/i.test(m.question || '')) { reasons.push('deadline market without a stated time zone'); score += 5; }
    if (d.length < 120) { reasons.push('very short rules text'); score += 10; }
    return { score: Math.min(100, score), reasons };
}

export function disputeRiskFor(conditionId: string): DisputeRisk | null {
    const m = get<MarketRow>(`SELECT ${MARKET_COLS} FROM markets WHERE condition_id = ?`, conditionId);
    return m ? disputeRisk(m) : null;
}

/** All active markets with a dispute risk ≥ minScore. */
export function disputeProneMarkets(minScore = 40, limit = 50): (MarketRow & DisputeRisk)[] {
    const rows = all<MarketRow>(`SELECT ${MARKET_COLS} FROM markets WHERE closed = 0 AND resolved = 0 ORDER BY volume24hr DESC LIMIT 800`);
    return rows.map(m => ({ ...m, ...disputeRisk(m) })).filter(x => x.score >= minScore).sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Rules-vs-headline gap (heuristic; optional LLM)
// ---------------------------------------------------------------------------
export interface HeadlineGap { flags: string[]; llm?: unknown }

const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?%?[kKmMbB]?/g;
const MONTH_RE = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/gi;

export function headlineGap(question: string, description: string): HeadlineGap {
    const flags: string[] = [];
    const q = question || '', d = (description || '').toLowerCase();
    const expand = (x: string) => { const m = /^([\d.]+)([kmb])?$/.exec(x.replace(/[$,%]/g, '').toLowerCase()); if (!m) return x; const mult = ({ k: 1e3, m: 1e6, b: 1e9 } as Record<string, number>)[m[2] || ''] ?? 1; return String(Math.round(parseFloat(m[1]) * mult)); };
    const qNoDates = q.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(st|nd|rd|th)?\b/gi, ' ').replace(/\b(19|20)\d{2}\b/g, ' ');
    const qNums = Array.from(new Set((qNoDates.match(NUM_RE) || []).map(expand))).filter(x => /\d/.test(x));
    const dNums = new Set((d.match(NUM_RE) || []).map(expand));
    for (const n of qNums) if (!dNums.has(n)) flags.push(`threshold "${n}" in headline is not in the rules`);
    const qMonths = Array.from(new Set((q.match(MONTH_RE) || []).map(x => x.toLowerCase().slice(0, 3))));
    for (const mo of qMonths) if (!new RegExp(`\\b${mo}`, 'i').test(d)) flags.push(`month "${mo}" in headline is not in the rules`);
    if (/\b(by|before)\b/i.test(q) && !/\b(11:59|23:59|end of day|eod|et\b|utc|gmt|est|edt|time zone|pm\b|am\b)/i.test(d)) flags.push('deadline headline, rules give no cut-off time / time zone');
    if (/\bannounce/i.test(d) && !/\bannounce/i.test(q)) flags.push('rules resolve on an announcement while the headline implies the event itself');
    if (/\bor\b/i.test(q) && /\bboth\b|\beither\b/i.test(d)) flags.push('"or" headline with both/either wording in rules');
    return { flags };
}

export async function headlineGapLlm(question: string, description: string): Promise<HeadlineGap> {
    const base = headlineGap(question, description);
    try {
        const { askJson } = await import('../intelligence/llm');
        const { data } = await askJson<{ gaps: string[]; edgeCaseProbability: number }>(`Compare this prediction market headline to its resolution rules and list every way the rules could resolve differently from what the headline implies (source, deadline, time zone, "announced" vs "happened", thresholds). Estimate the probability (0-1) that an edge case decides the outcome.\nHEADLINE: ${question}\nRULES: ${description.slice(0, 3000)}\nReturn JSON {"gaps": string[], "edgeCaseProbability": number}`);
        return { ...base, llm: data };
    } catch (e) { return { ...base, llm: { error: (e as Error).message } }; }
}

// ---------------------------------------------------------------------------
// Early-resolution scanner
// ---------------------------------------------------------------------------
export interface EarlyResolution { condition_id: string; question: string; event_slug: string; winner_index: number; winnerOutcome: string; yes_price: number; gapCents: number; source: 'clob' | 'uma'; uma_status: string; disputeRisk: DisputeRisk }

/**
 * Markets whose outcome is known (CLOB winner declared, or UMA status proposed/resolved) but whose stored price is still
 * between 0.02 and 0.98. Checks CLOB live for up to `checkLimit` candidates: markets past end_ts or with a UMA status.
 */
export async function earlyResolutionScan(checkLimit = 60): Promise<EarlyResolution[]> {
    const t = now();
    const cands = all<MarketRow>(`SELECT ${MARKET_COLS} FROM markets WHERE yes_price IS NOT NULL AND yes_price > 0.02 AND yes_price < 0.98
        AND (resolved = 1 OR (uma_status != '' AND uma_status IS NOT NULL) OR (end_ts IS NOT NULL AND end_ts < ?)) ORDER BY volume24hr DESC LIMIT ?`, t, checkLimit);
    const out: EarlyResolution[] = [];
    for (const m of cands) {
        if (m.best_bid === null || m.best_ask === null) continue;   // placeholder / dead book: price is not tradeable
        let winner = m.resolved ? m.winner_index : null; let source: 'clob' | 'uma' = 'clob';
        if (winner === null) {
            const c = await clobMarket(m.condition_id, 60_000);
            if (c && c.resolved) winner = c.winnerIndex;
            // UMA proposed/resolved without a CLOB winner yet: the side the market leans to is the *proposed* outcome; unverified.
            else if (/proposed|resolved|settled/i.test(m.uma_status) && (m.yes_price! >= 0.8 || m.yes_price! <= 0.2)) { source = 'uma'; winner = m.yes_price! >= 0.5 ? 0 : 1; }
        }
        if (winner === null) continue;
        const outcomes = JSON.parse(m.outcomes || '[]') as string[];
        const fair = winner === 0 ? 1 : 0;
        const gap = Math.abs(fair - m.yes_price!) * 100;
        if (gap < 2) continue;
        out.push({ condition_id: m.condition_id, question: m.question, event_slug: m.event_slug, winner_index: winner, winnerOutcome: (outcomes[winner] ?? String(winner)) + (source === 'uma' ? ' (proposed, unverified)' : ''), yes_price: m.yes_price!, gapCents: Math.round(gap * 10) / 10, source, uma_status: m.uma_status, disputeRisk: disputeRisk(m) });
    }
    transaction(() => { for (const e of out) run('INSERT INTO signals(type, ts, condition_id, outcome_index, score, payload) VALUES (?,?,?,?,?,?)', 'early_resolution', t, e.condition_id, e.winner_index, Math.min(100, e.gapCents * 5), JSON.stringify({ question: e.question, yes_price: e.yes_price, gapCents: e.gapCents, source: e.source, uma: e.uma_status, disputeRisk: e.disputeRisk.score })); });
    return out.sort((a, b) => b.gapCents - a.gapCents);
}

// ---------------------------------------------------------------------------
// Clarification alerts (rules_changed signals written by lib/pm/ingest.ts upsertMarket)
// ---------------------------------------------------------------------------
export function lineDiff(before: string, after: string): { removed: string[]; added: string[] } {
    const split = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
    const a = split(before), b = split(after);
    const sa = new Set(a), sb = new Set(b);
    return { removed: a.filter(x => !sb.has(x)), added: b.filter(x => !sa.has(x)) };
}

export function clarificationAlerts(sinceSec = 7 * 86400): { ts: number; condition_id: string; question: string; diff: ReturnType<typeof lineDiff> }[] {
    const rows = all<{ ts: number; condition_id: string; payload: string }>(`SELECT ts, condition_id, payload FROM signals WHERE type = 'rules_changed' AND ts > ? ORDER BY ts DESC`, now() - sinceSec);
    return rows.map(r => { const p = JSON.parse(r.payload || '{}'); return { ts: r.ts, condition_id: r.condition_id, question: p.question ?? '', diff: lineDiff(p.before ?? '', p.after ?? '') }; });
}

// ---------------------------------------------------------------------------
// Resolution source monitor
// ---------------------------------------------------------------------------
export function seedSourceWatch(limit = 200): number {
    ensureSchema();
    const rows = all<{ condition_id: string; resolution_source: string }>(`SELECT condition_id, resolution_source FROM markets WHERE closed = 0 AND resolution_source LIKE 'http%' ORDER BY volume24hr DESC LIMIT ?`, limit);
    let n = 0;
    transaction(() => { for (const r of rows) n += Number(run('INSERT OR IGNORE INTO source_watch(condition_id, url) VALUES (?,?)', r.condition_id, r.resolution_source.trim()).changes); });
    return n;
}

export async function checkSources(limit = 50, log: (m: string) => void = () => {}): Promise<{ checked: number; changed: { condition_id: string; url: string }[] }> {
    ensureSchema();
    const rows = all<{ condition_id: string; url: string; last_hash: string | null }>('SELECT condition_id, url, last_hash FROM source_watch ORDER BY last_checked ASC NULLS FIRST LIMIT ?', limit);
    const changed: { condition_id: string; url: string }[] = [];
    for (const r of rows) {
        try {
            const body = await getText(r.url, { timeoutMs: 15_000, retries: 1, spacingMs: 500, headers: { Accept: 'text/html,application/json,*/*' } });
            // strip volatile bits (timestamps, nonces) crudely before hashing
            const h = createHash('sha1').update(body.replace(/\d{2}:\d{2}(:\d{2})?/g, '').replace(/nonce="[^"]*"/g, '')).digest('hex');
            const t = now();
            if (r.last_hash && r.last_hash !== h) { changed.push({ condition_id: r.condition_id, url: r.url }); run('INSERT INTO signals(type, ts, condition_id, score, payload) VALUES (?,?,?,?,?)', 'source_changed', t, r.condition_id, 40, JSON.stringify({ url: r.url })); run('UPDATE source_watch SET last_hash=?, last_checked=?, last_changed=? WHERE condition_id=? AND url=?', h, t, t, r.condition_id, r.url); }
            else run('UPDATE source_watch SET last_hash=?, last_checked=? WHERE condition_id=? AND url=?', h, t, r.condition_id, r.url);
        } catch (e) { log(`source ${r.url}: ${(e as Error).message.slice(0, 80)}`); run('UPDATE source_watch SET last_checked=? WHERE condition_id=? AND url=?', now(), r.condition_id, r.url); }
    }
    return { checked: rows.length, changed };
}

// ---------------------------------------------------------------------------
// Past-resolution database
// ---------------------------------------------------------------------------
export const QUESTION_PATTERNS: Record<string, RegExp> = {
    by_date: /\b(by|before)\s+(january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|end of)/i,
    announce: /\bannounc/i,
    above_threshold: /\b(above|over|exceed|more than|at least|reach(es)?|hit)\b/i,
    below_threshold: /\b(below|under|less than|fall)\b/i,
    win: /\bwin(s|ner)?\b/i,
    say_or_mention: /\b(say|says|mention|tweet|post)\b/i
};

export function resolutionHistory(opts: { category?: string; pattern?: keyof typeof QUESTION_PATTERNS } = {}): { pattern: string; category: string; n: number; yesShare: number }[] {
    const rows = all<{ question: string; category: string; winner_index: number; outcomes: string; end_ts: number | null }>(`SELECT question, category, winner_index, outcomes, end_ts FROM markets WHERE resolved = 1 AND winner_index IS NOT NULL ${opts.category ? 'AND category = ?' : ''}`, ...(opts.category ? [opts.category] : []));
    const pats = opts.pattern ? [opts.pattern] : Object.keys(QUESTION_PATTERNS);
    const out: { pattern: string; category: string; n: number; yesShare: number }[] = [];
    for (const p of pats) {
        const re = QUESTION_PATTERNS[p];
        const byCat = new Map<string, { n: number; yes: number }>();
        for (const r of rows) {
            if (!re.test(r.question)) continue;
            const outcomes = JSON.parse(r.outcomes || '[]') as string[];
            const binary = outcomes.length === 2 && /^yes$/i.test(outcomes[0]);
            if (!binary) continue;
            const key = opts.category ?? r.category ?? 'other';
            const c = byCat.get(key) ?? { n: 0, yes: 0 }; c.n++; if (r.winner_index === 0) c.yes++; byCat.set(key, c);
            const allc = byCat.get('all') ?? { n: 0, yes: 0 }; allc.n++; if (r.winner_index === 0) allc.yes++; byCat.set('all', allc);
        }
        Array.from(byCat.entries()).forEach(([cat, v]) => out.push({ pattern: p, category: cat, n: v.n, yesShare: v.n ? v.yes / v.n : 0 }));
    }
    return out.sort((a, b) => b.n - a.n);
}
