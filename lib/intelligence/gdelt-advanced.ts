/**
 * GDELT DOC 2.0 client (news evidence).
 *
 * Audit 2026-09-25 findings fixed here:
 *  - GDELT enforces ONE request per 5 seconds per IP and answers with a plain-text
 *    "Please limit requests..." body (HTTP 200). The old code fired two requests in
 *    parallel per market, so the second was always refused and silently parsed as [].
 *    All requests now go through a single-flight queue with 5.5s spacing and the
 *    refusal text is detected and surfaced.
 *  - The artlist mode does NOT return a tone value. The old code read `socialimage`
 *    (an image URL) as tone. Tone filtering only works inside the query string.
 *  - Quoting 3-letter words ("Fed") yields "The specified phrase is too short."
 *    Single words are no longer quoted; only multi-word phrases are.
 */

const BASE_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const MIN_SPACING_MS = 5_500;

export interface GdeltAdvancedArticle {
    url: string;
    title: string;
    source: string;
    date: string;      // ISO
    language: string;
    domain: string;
    /** Only present for queries that filtered by tone; the API does not return tone per article. */
    tone?: number;
}

export class GdeltRateLimitError extends Error {
    constructor() { super('GDELT rate limit: one request per 5 seconds per IP'); }
}

// ---- single-flight queue ----------------------------------------------------
let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;
function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
        const wait = lastCallAt + MIN_SPACING_MS - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastCallAt = Date.now();
        return fn();
    };
    const p = chain.then(run, run);
    chain = p.catch(() => undefined);
    return p;
}

function parseSeenDate(s: string): string {
    // GDELT format: 20260925T081500Z
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
    if (!m) return new Date(s).toISOString();
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

async function queryGDELT(query: string, timespan: string, maxrecords = 10): Promise<GdeltAdvancedArticle[]> {
    return schedule(async () => {
        const url = `${BASE_URL}?query=${encodeURIComponent(query)}&mode=artlist&timespan=${timespan}&format=json&sort=DateDesc&maxrecords=${maxrecords}`;
        const response = await fetch(url);
        const text = await response.text();
        if (/limit requests to one every 5 seconds/i.test(text)) throw new GdeltRateLimitError();
        if (/phrase is too short|No matching|syntax/i.test(text) && !text.trim().startsWith('{')) {
            console.warn('[GDELT] query rejected:', text.trim().slice(0, 120), '| query:', query);
            return [];
        }
        let data: { articles?: unknown[] };
        try { data = JSON.parse(text); } catch { console.warn('[GDELT] non-JSON response:', text.slice(0, 120)); return []; }
        if (!Array.isArray(data.articles)) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (data.articles as any[]).flatMap(a => {
            try {
                return [{
                    url: String(a.url),
                    title: String(a.title || ''),
                    source: String(a.domain || a.sourcecountry || ''),
                    date: parseSeenDate(String(a.seendate || '')),
                    language: String(a.language || ''),
                    domain: new URL(String(a.url)).hostname
                }];
            } catch { return []; }
        });
    });
}

/** Build a GDELT boolean query: quote phrases, leave single words bare, AND everything. */
export function buildKeywordQuery(keywords: string[]): string {
    const parts = keywords
        .map(k => k.trim())
        .filter(k => k.length >= 3)
        .map(k => (k.includes(' ') ? `"${k}"` : k));
    return parts.join(' ');
}

const GOV_DOMAINS: Record<string, string> = {
    us: '(domain:.gov OR domain:house.gov OR domain:senate.gov OR domain:federalreserve.gov)',
    uk: 'domain:gov.uk',
    br: 'domain:gov.br',
    eu: '(domain:europa.eu OR domain:europarl.europa.eu)'
};

/** Articles from official government domains matching ALL keywords. */
export async function fetchGovDocs(keywords: string[], countryCode = 'us', timespan = '48h'): Promise<GdeltAdvancedArticle[]> {
    const kw = buildKeywordQuery(keywords);
    if (!kw) return [];
    const domain = GOV_DOMAINS[countryCode] || `domain:gov.${countryCode}`;
    return queryGDELT(`${domain} ${kw}`, timespan);
}

/** Strongly negative coverage (tone < -5) matching ALL keywords. */
export async function fetchNegativeSignals(keywords: string[], timespan = '24h'): Promise<GdeltAdvancedArticle[]> {
    const kw = buildKeywordQuery(keywords);
    if (!kw) return [];
    const arts = await queryGDELT(`${kw} tone<-5`, timespan);
    return arts.map(a => ({ ...a, tone: -5 }));
}

/** Plain recent news matching ALL keywords (Tier 3 fallback). */
export async function fetchStandardNews(keywords: string[], timespan = '24h'): Promise<GdeltAdvancedArticle[]> {
    const kw = buildKeywordQuery(keywords);
    if (!kw) return [];
    return queryGDELT(kw, timespan);
}

/** Non-English coverage matching ALL keywords (the "language edge" the landing page promises). */
export async function fetchNonEnglishNews(keywords: string[], langs = ['spa', 'por', 'deu', 'fra', 'zho', 'jpn'], timespan = '24h'): Promise<GdeltAdvancedArticle[]> {
    const kw = buildKeywordQuery(keywords);
    if (!kw) return [];
    return queryGDELT(`${kw} (${langs.map(l => `sourcelang:${l}`).join(' OR ')})`, timespan);
}

/**
 * Sequential spike detection for one market. Runs gov → negative in order
 * (never in parallel: GDELT allows one request per 5 seconds).
 */
export async function detectSignalSpikes(marketTitle: string, marketKeywords: string[], countryCode = 'us'): Promise<{ negative: GdeltAdvancedArticle[]; gov: GdeltAdvancedArticle[] }> {
    console.log(`[GDELT] scanning: ${marketTitle}`);
    const gov = await fetchGovDocs(marketKeywords, countryCode);
    const negative = gov.length ? [] : await fetchNegativeSignals(marketKeywords);
    return { negative, gov };
}
