/**
 * Shared HTTP layer for all prediction-market APIs.
 * - Per-host minimum spacing (token bucket of size 1) so parallel callers never burst a host.
 * - Retry with exponential backoff on 429 / 5xx / network errors.
 * - Optional in-memory TTL cache keyed by URL.
 * - Every response is parsed defensively; callers get typed `unknown` and validate.
 */

export interface HttpOptions {
    /** Minimum ms between requests to this host. Default from HOST_SPACING or 150. */
    spacingMs?: number;
    /** Cache TTL in ms. 0 = no cache. */
    ttlMs?: number;
    /** Retries on 429/5xx. Default 4. */
    retries?: number;
    /** Request timeout ms. Default 20000. */
    timeoutMs?: number;
    headers?: Record<string, string>;
}

const HOST_SPACING: Record<string, number> = {
    'gamma-api.polymarket.com': 120,
    'data-api.polymarket.com': 150,
    'clob.polymarket.com': 120,
    'api.elections.kalshi.com': 120,
    'api.gdeltproject.org': 5_500
};

const lastCall = new Map<string, number>();
const chains = new Map<string, Promise<unknown>>();
const cache = new Map<string, { at: number; value: unknown }>();

export class HttpError extends Error {
    constructor(public status: number, public url: string, public body: string) {
        super(`HTTP ${status} ${url}: ${body.slice(0, 160)}`);
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function throttle<T>(host: string, spacing: number, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(host) ?? Promise.resolve();
    const run = async () => {
        const wait = (lastCall.get(host) ?? 0) + spacing - Date.now();
        if (wait > 0) await sleep(wait);
        lastCall.set(host, Date.now());
        return fn();
    };
    const p = prev.then(run, run);
    chains.set(host, p.catch(() => undefined));
    return p;
}

export async function getText(url: string, opts: HttpOptions = {}): Promise<string> {
    const host = new URL(url).host;
    const spacing = opts.spacingMs ?? HOST_SPACING[host] ?? 150;
    const retries = opts.retries ?? 4;
    const timeoutMs = opts.timeoutMs ?? 20_000;
    if (opts.ttlMs) {
        const hit = cache.get(url);
        if (hit && Date.now() - hit.at < opts.ttlMs) return hit.value as string;
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const text = await throttle(host, spacing, async () => {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), timeoutMs);
                try {
                    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'polygloth/2.0', ...(opts.headers ?? {}) }, signal: ctrl.signal });
                    const body = await res.text();
                    if (!res.ok) throw new HttpError(res.status, url, body);
                    return body;
                } finally { clearTimeout(t); }
            });
            if (opts.ttlMs) cache.set(url, { at: Date.now(), value: text });
            return text;
        } catch (e) {
            lastErr = e;
            const status = e instanceof HttpError ? e.status : 0;
            const retryable = status === 429 || status >= 500 || status === 0;
            if (!retryable || attempt === retries) throw e;
            await sleep(Math.min(20_000, 800 * 2 ** attempt + Math.random() * 300));
        }
    }
    throw lastErr;
}

export async function getJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
    const text = await getText(url, opts);
    try { return JSON.parse(text) as T; }
    catch { throw new HttpError(200, url, `non-JSON body: ${text.slice(0, 120)}`); }
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
    const s = u.toString();
    return s ? `?${s}` : '';
}

export const num = (v: unknown, fallback = 0): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : fallback;
};

export const str = (v: unknown, fallback = ''): string => (v === undefined || v === null ? fallback : String(v));

export function parseJsonArray<T = string>(v: unknown): T[] {
    if (Array.isArray(v)) return v as T[];
    try { const p = JSON.parse(String(v ?? '[]')); return Array.isArray(p) ? p : []; } catch { return []; }
}

/** For tests: clear cache and host timers. */
export function _resetHttp() { cache.clear(); lastCall.clear(); chains.clear(); }
