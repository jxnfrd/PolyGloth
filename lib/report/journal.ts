import { openDb, all, get, run, transaction, now } from '../pm/db';

/**
 * Trade journal with auto-tagging, performance attribution, unified paper portfolio and tax export
 * (mega-list 13.22, 13.27–13.29). Source of truth is `paper_orders` (paper only; no live venue keys).
 *
 * Attribution (per order, sums exactly to realized P/L):
 *   reference = leader/signal price parsed from paper_orders.reason ("leader @0.57"), else the fill price
 *   close     = last known price of the held side before resolution (`prices` table, else markets.yes_price)
 *   skill     = (close − reference) × shares            → closing-line value: did the price move our way after entry?
 *   slippage  = −(fill − reference) × shares            → cost of filling worse than the reference
 *   fees      = −feeBps/1e4 × notional                  → 0 on Polymarket by default
 *   luck      = realized − skill − slippage − fees      → resolution noise beyond the closing line (= (final − close) × shares when fees=0)
 * Under an efficient-market prior the expected P/L at entry is 0, so "skill" here is closing-line value, the
 * standard sharp-vs-square measure, not a claim about causality.
 */

export interface JournalEntry { id: number; ts: number; paper_order_id: number | null; strategy: string | null; condition_id: string; outcome_index: number; side: string; price: number; usd: number; reasons: string[]; tags: string[]; note: string | null; outcome: string | null; pnl: number | null; question?: string; category?: string }

export function ensureSchema() {
    openDb();
    run(`CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, paper_order_id INTEGER UNIQUE, strategy TEXT, condition_id TEXT NOT NULL, outcome_index INTEGER NOT NULL,
        side TEXT NOT NULL, price REAL NOT NULL, usd REAL NOT NULL, reasons TEXT, tags TEXT, note TEXT, outcome TEXT, pnl REAL, updated_ts INTEGER)`);
    run(`CREATE INDEX IF NOT EXISTS idx_journal_ts ON journal_entries(ts DESC)`);
}

const safe = (v: unknown): unknown => { if (typeof v !== 'string') return v ?? null; try { return JSON.parse(v); } catch { return null; } };
const arr = (v: unknown): string[] => (Array.isArray(safe(v)) ? (safe(v) as unknown[]).map(String) : []);

export function priceBucket(price: number): string { return price <= 0.15 ? 'longshot' : price >= 0.85 ? 'near_certain' : price >= 0.7 ? 'favorite' : 'midrange'; }

/** Tags for an order: strategy family, category, price bucket, and signal types on the same market within ±2h. */
export function autoTags(o: { strategy: string; condition_id: string; price: number; ts: number; reason?: string | null }, category?: string | null, signalTypes: string[] = []): string[] {
    const t = new Set<string>();
    const s = o.strategy.toLowerCase();
    t.add(`strategy:${o.strategy}`);
    if (s.startsWith('copy')) t.add('whale_copy');
    if (s.includes('fade')) t.add('fade');
    if (s.includes('arb')) t.add('arb');
    if (s.includes('near_certainty')) t.add('near_certainty');
    if (s.includes('thin_move')) t.add('mean_reversion');
    if (s.includes('decay')) t.add('deadline_decay');
    if (s.startsWith('kalshi:')) t.add('venue:kalshi'); else t.add('venue:polymarket');
    if (category) t.add(`cat:${category}`);
    t.add(priceBucket(o.price));
    for (const st of signalTypes) t.add(`signal:${st}`);
    return Array.from(t).sort();
}

export function reasonsFrom(reason: string | null | undefined): string[] { return String(reason ?? '').split('|').map(s => s.trim()).filter(Boolean); }

/** Create journal entries for paper orders not yet journaled; refresh outcome/pnl for existing ones. */
export function sync(): { created: number; updated: number } {
    ensureSchema();
    const orders = all<{ id: number; strategy: string; ts: number; condition_id: string; outcome_index: number; side: string; price: number; usd: number; reason: string | null; status: string; pnl: number | null; category: string | null }>(
        `SELECT p.id, p.strategy, p.ts, p.condition_id, p.outcome_index, p.side, p.price, p.usd, p.reason, p.status, p.pnl, m.category FROM paper_orders p LEFT JOIN markets m ON m.condition_id = p.condition_id WHERE p.status != 'rejected' ORDER BY p.ts`);
    let created = 0, updated = 0;
    transaction(() => {
        for (const o of orders) {
            const outcome = o.status === 'resolved' || o.status === 'closed' ? (o.pnl === null ? null : o.pnl > 0 ? 'WIN' : o.pnl < 0 ? 'LOSS' : 'FLAT') : null;
            const existing = get<{ id: number; outcome: string | null; pnl: number | null }>('SELECT id, outcome, pnl FROM journal_entries WHERE paper_order_id = ?', o.id);
            if (existing) {
                if (existing.outcome !== outcome || existing.pnl !== o.pnl) { run('UPDATE journal_entries SET outcome = ?, pnl = ?, updated_ts = ? WHERE id = ?', outcome, o.pnl, now(), existing.id); updated++; }
                continue;
            }
            const sigTypes = all<{ type: string }>('SELECT DISTINCT type FROM signals WHERE condition_id = ? AND ABS(ts - ?) <= 7200', o.condition_id, o.ts).map(r => r.type);
            run(`INSERT INTO journal_entries(ts, paper_order_id, strategy, condition_id, outcome_index, side, price, usd, reasons, tags, note, outcome, pnl, updated_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                o.ts, o.id, o.strategy, o.condition_id, o.outcome_index, o.side, o.price, o.usd, JSON.stringify(reasonsFrom(o.reason)), JSON.stringify(autoTags(o, o.category, sigTypes)), null, outcome, o.pnl, now());
            created++;
        }
    });
    return { created, updated };
}

export function addManualEntry(e: { ts?: number; condition_id: string; outcome_index: number; side: 'BUY' | 'SELL'; price: number; usd: number; note?: string; tags?: string[] }): number {
    ensureSchema();
    const cat = get<{ category: string }>('SELECT category FROM markets WHERE condition_id = ?', e.condition_id)?.category;
    const tags = Array.from(new Set([...(e.tags ?? []), 'manual', priceBucket(e.price), ...(cat ? [`cat:${cat}`] : [])])).sort();
    const r = run(`INSERT INTO journal_entries(ts, paper_order_id, strategy, condition_id, outcome_index, side, price, usd, reasons, tags, note, updated_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, e.ts ?? now(), null, 'manual', e.condition_id, e.outcome_index, e.side, e.price, e.usd, '[]', JSON.stringify(tags), e.note ?? null, now());
    return Number(r.lastInsertRowid);
}

export function entries(limit = 200): JournalEntry[] {
    ensureSchema();
    return all<Record<string, unknown>>(`SELECT j.*, m.question, m.category FROM journal_entries j LEFT JOIN markets m ON m.condition_id = j.condition_id ORDER BY j.ts DESC LIMIT ?`, limit)
        .map(r => ({ ...(r as unknown as JournalEntry), reasons: arr(r.reasons), tags: arr(r.tags) }));
}

export interface TagScore { tag: string; n: number; resolved: number; wins: number; hitRate: number | null; staked: number; pnl: number; roi: number | null }

/** Which reasons actually make money: per tag over entries with a known outcome. */
export function scoreTags(): TagScore[] {
    ensureSchema();
    const rows = all<{ tags: string; usd: number; pnl: number | null; outcome: string | null }>('SELECT tags, usd, pnl, outcome FROM journal_entries');
    const acc = new Map<string, TagScore>();
    for (const r of rows) {
        for (const tag of arr(r.tags)) {
            const t = acc.get(tag) ?? { tag, n: 0, resolved: 0, wins: 0, hitRate: null, staked: 0, pnl: 0, roi: null };
            t.n++;
            if (r.outcome !== null && r.pnl !== null) { t.resolved++; if (r.pnl > 0) t.wins++; t.staked += r.usd; t.pnl += r.pnl; }
            acc.set(tag, t);
        }
    }
    return Array.from(acc.values()).map(t => ({ ...t, hitRate: t.resolved ? t.wins / t.resolved : null, roi: t.staked ? t.pnl / t.staked : null })).sort((a, b) => b.pnl - a.pnl);
}

export interface Attribution { strategy: string; n: number; realized: number; skill: number; slippage: number; fees: number; luck: number; staked: number }

export function referencePrice(reason: string | null | undefined, fill: number): number {
    const m = /(?:leader|signal|ref)\s*@\s*(0?\.\d+|1(?:\.0+)?)/i.exec(String(reason ?? ''));
    return m ? Number(m[1]) : fill;
}

/** Last known price of the held side before resolution. */
export function closingPrice(conditionId: string, outcomeIndex: number): number | null {
    const m = get<{ yes_price: number | null; clob_token_ids: string | null }>('SELECT yes_price, clob_token_ids FROM markets WHERE condition_id = ?', conditionId);
    if (!m) return null;
    const tokens = arr(m.clob_token_ids);
    const tok = tokens[outcomeIndex];
    if (tok) { const p = get<{ price: number }>('SELECT price FROM prices WHERE token_id = ? ORDER BY ts DESC LIMIT 1', tok); if (p) return p.price; }
    if (m.yes_price === null) return null;
    return outcomeIndex === 0 ? m.yes_price : 1 - m.yes_price;
}

/** Performance attribution per strategy over closed/resolved paper orders. Sums exactly to realized P/L. */
export function attribution(feeBps = 0): { byStrategy: Attribution[]; total: Attribution } {
    ensureSchema();
    const rows = all<{ strategy: string; condition_id: string; outcome_index: number; price: number; size: number; usd: number; pnl: number | null; reason: string | null; close_price: number | null }>(
        `SELECT strategy, condition_id, outcome_index, price, size, usd, pnl, reason, close_price FROM paper_orders WHERE status IN ('closed','resolved') AND pnl IS NOT NULL AND side = 'BUY'`);
    const acc = new Map<string, Attribution>();
    const mk = (s: string): Attribution => ({ strategy: s, n: 0, realized: 0, skill: 0, slippage: 0, fees: 0, luck: 0, staked: 0 });
    const total = mk('total');
    for (const r of rows) {
        const ref = referencePrice(r.reason, r.price);
        const close = closingPrice(r.condition_id, r.outcome_index) ?? r.price;
        const shares = r.size;
        const skill = (close - ref) * shares;
        const slippage = -(r.price - ref) * shares;
        const fees = -(feeBps / 10_000) * r.usd;
        const luck = r.pnl! - skill - slippage - fees;
        for (const a of [acc.get(r.strategy) ?? mk(r.strategy), total]) {
            a.n++; a.realized += r.pnl!; a.skill += skill; a.slippage += slippage; a.fees += fees; a.luck += luck; a.staked += r.usd;
            if (a !== total) acc.set(r.strategy, a);
        }
    }
    return { byStrategy: Array.from(acc.values()).sort((a, b) => b.realized - a.realized), total };
}

export interface PortfolioLine { id: number; strategy: string; venue: 'polymarket' | 'kalshi'; condition_id: string; question: string | null; category: string | null; event_slug: string | null; outcome_index: number; shares: number; cost: number; entry: number; mark: number | null; value: number | null; unrealized: number | null; ts: number }

/** Unified paper portfolio: open orders marked at the current price of the held side. */
export function portfolio(): { lines: PortfolioLine[]; byCategory: { category: string; cost: number; value: number; unrealized: number; n: number }[]; byEvent: { event_slug: string; cost: number; value: number; unrealized: number; n: number }[]; totals: { cost: number; value: number; unrealized: number; n: number }; kalshiNote: string } {
    ensureSchema();
    const rows = all<{ id: number; strategy: string; ts: number; condition_id: string; outcome_index: number; price: number; size: number; usd: number; question: string | null; category: string | null; event_slug: string | null; yes_price: number | null }>(
        `SELECT p.id, p.strategy, p.ts, p.condition_id, p.outcome_index, p.price, p.size, p.usd, m.question, m.category, m.event_slug, m.yes_price FROM paper_orders p LEFT JOIN markets m ON m.condition_id = p.condition_id WHERE p.status = 'open' AND p.side = 'BUY' ORDER BY p.usd DESC`);
    const lines: PortfolioLine[] = rows.map(r => {
        const venue = r.strategy.startsWith('kalshi:') ? 'kalshi' as const : 'polymarket' as const;
        const mark = r.yes_price === null ? null : r.outcome_index === 0 ? r.yes_price : 1 - r.yes_price;
        const value = mark === null ? null : mark * r.size;
        return { id: r.id, strategy: r.strategy, venue, condition_id: r.condition_id, question: r.question, category: r.category, event_slug: r.event_slug, outcome_index: r.outcome_index, shares: r.size, cost: r.usd, entry: r.price, mark, value, unrealized: value === null ? null : value - r.usd, ts: r.ts };
    });
    const group = <K extends string>(key: (l: PortfolioLine) => K) => {
        const m = new Map<string, { cost: number; value: number; unrealized: number; n: number }>();
        for (const l of lines) { const k = key(l) || 'unknown'; const g = m.get(k) ?? { cost: 0, value: 0, unrealized: 0, n: 0 }; g.cost += l.cost; g.value += l.value ?? l.cost; g.unrealized += l.unrealized ?? 0; g.n++; m.set(k, g); }
        return Array.from(m.entries()).map(([k, g]) => ({ key: k, ...g })).sort((a, b) => b.cost - a.cost);
    };
    const totals = lines.reduce((t, l) => ({ cost: t.cost + l.cost, value: t.value + (l.value ?? l.cost), unrealized: t.unrealized + (l.unrealized ?? 0), n: t.n + 1 }), { cost: 0, value: 0, unrealized: 0, n: 0 });
    const kalshi = lines.filter(l => l.venue === 'kalshi').length;
    return {
        lines,
        byCategory: group(l => l.category ?? 'unknown').map(g => ({ category: g.key, cost: g.cost, value: g.value, unrealized: g.unrealized, n: g.n })),
        byEvent: group(l => l.event_slug ?? 'unknown').map(g => ({ event_slug: g.key, cost: g.cost, value: g.value, unrealized: g.unrealized, n: g.n })),
        totals,
        kalshiNote: kalshi ? `${kalshi} Kalshi paper legs included (strategy prefix kalshi:)` : 'No Kalshi paper legs yet (strategies with prefix kalshi: would appear here).'
    };
}

/** CSV of closed/resolved paper orders. `country` only changes the date format; this is a record export, not tax advice. */
export function taxCsv(country = 'ISO'): string {
    ensureSchema();
    const rows = all<{ id: number; strategy: string; ts: number; close_ts: number | null; price: number; size: number; usd: number; pnl: number | null; close_price: number | null; side: string; question: string | null; event_slug: string | null }>(
        `SELECT p.id, p.strategy, p.ts, p.close_ts, p.price, p.size, p.usd, p.pnl, p.close_price, p.side, m.question, m.event_slug FROM paper_orders p LEFT JOIN markets m ON m.condition_id = p.condition_id WHERE p.status IN ('closed','resolved') ORDER BY COALESCE(p.close_ts, p.ts)`);
    const fmt = (ts: number | null) => { if (!ts) return ''; const d = new Date(ts * 1000); const iso = d.toISOString().slice(0, 10); return country.toUpperCase() === 'US' ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : iso; };
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['open_date', 'close_date', 'venue', 'strategy', 'market', 'event', 'side', 'qty', 'entry_price', 'cost', 'proceeds', 'pnl', 'holding_days'];
    const lines = rows.map(r => {
        const venue = r.strategy.startsWith('kalshi:') ? 'kalshi' : 'polymarket';
        const proceeds = r.pnl === null ? '' : (r.usd + r.pnl).toFixed(2);
        const days = r.close_ts ? ((r.close_ts - r.ts) / 86400).toFixed(1) : '';
        return [fmt(r.ts), fmt(r.close_ts), venue, r.strategy, r.question ?? '', r.event_slug ?? '', r.side, r.size.toFixed(4), r.price.toFixed(4), r.usd.toFixed(2), proceeds, r.pnl === null ? '' : r.pnl.toFixed(2), days].map(esc).join(',');
    });
    return [head.join(','), ...lines].join('\n') + '\n';
}
