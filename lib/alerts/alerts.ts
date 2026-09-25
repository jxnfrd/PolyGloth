import { openDb, all, get, run, transaction, now } from '../pm/db';

/**
 * Alert composer (mega-list 13.23): rules are JSON, no code. A rule matches `signals` rows
 * (joined with markets + wallet_scores) and can require several signal types on the same market
 * inside a time window ("consensus + comment_spike within 60 min").
 *
 * Tables (created here): alert_rules, alerts. Delivery: Telegram Bot API via fetch when
 * TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set; otherwise alerts stay delivered=0 and are printed.
 */

export interface AlertRule {
    /** Signal types that trigger the rule (any of). Empty/undefined = any type. */
    signalTypes?: string[];
    minScore?: number;
    categories?: string[];
    /** Market YES price bounds (0..1) at evaluation time. */
    priceMin?: number;
    priceMax?: number;
    /** Wallet thresholds from wallet_scores (category 'all', window 0); only checked when the signal has a wallet. */
    walletMinCalibratedRoi?: number;
    walletMaxPValue?: number;
    walletMinResolved?: number;
    /** payload.usdc (consensus, insider, fade carry it). */
    minUsdc?: number;
    /** payload.edge or payload.spread (arb_* types), as a fraction (0.01 = 1%). */
    minEdge?: number;
    /** payload.gapCents (early_resolution). */
    minGapCents?: number;
    /** payload.wallets.length (consensus, shill_cluster). */
    minWallets?: number;
    /** Combined alerts: every listed type must also appear on the same market within the window of the triggering signal. */
    requireAll?: { signalType: string; withinMinutes: number }[];
    excludeSports?: boolean;
}

export interface AlertRuleRow { id: number; name: string; enabled: number; created_ts: number; rule: AlertRule }
export interface AlertRow { id: number; rule_id: number; rule_name?: string; ts: number; condition_id: string | null; outcome_index: number | null; wallet: string | null; signal_ids: number[]; summary: string; delivered: number; question?: string; category?: string }

export function ensureSchema() {
    openDb();
    run(`CREATE TABLE IF NOT EXISTS alert_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, enabled INTEGER DEFAULT 1, created_ts INTEGER NOT NULL, rule TEXT NOT NULL)`);
    run(`CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INTEGER NOT NULL, ts INTEGER NOT NULL, condition_id TEXT, outcome_index INTEGER, wallet TEXT, signal_ids TEXT, summary TEXT, delivered INTEGER DEFAULT 0, delivered_ts INTEGER, dedupe_key TEXT)`);
    run(`CREATE INDEX IF NOT EXISTS idx_alerts_rule_ts ON alerts(rule_id, ts DESC)`);
    // SQLite treats NULLs as distinct in unique indexes, so the dedupe key is materialized (market signals: per market/outcome/day; market-less signals such as arb_multi_outcome: per event/day, else per signal).
    run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedupe_key ON alerts(dedupe_key)`);
}

export const DEFAULT_RULES: { name: string; rule: AlertRule }[] = [
    { name: 'Smart-money consensus (≥2 scored wallets, non-sports)', rule: { signalTypes: ['consensus'], minWallets: 2, excludeSports: true } },
    { name: 'Insider flag ≥7 (non-sports)', rule: { signalTypes: ['insider'], minScore: 7, excludeSports: true } },
    { name: 'Arbitrage edge ≥1%', rule: { signalTypes: ['arb_multi_outcome', 'arb_ladder', 'arb_logical', 'arb_cross_venue'], minEdge: 0.01 } },
    { name: 'Early resolution gap ≥5¢', rule: { signalTypes: ['early_resolution'], minGapCents: 5 } }
];

export function seedDefaults(): number {
    ensureSchema();
    const n = get<{ n: number }>('SELECT COUNT(*) n FROM alert_rules')?.n ?? 0;
    if (n > 0) return 0;
    transaction(() => { for (const r of DEFAULT_RULES) run('INSERT INTO alert_rules(name, enabled, created_ts, rule) VALUES (?,?,?,?)', r.name, 1, now(), JSON.stringify(r.rule)); });
    return DEFAULT_RULES.length;
}

export function createRule(name: string, rule: AlertRule): number {
    ensureSchema();
    const r = run('INSERT INTO alert_rules(name, enabled, created_ts, rule) VALUES (?,?,?,?)', name.trim() || 'untitled', 1, now(), JSON.stringify(rule));
    return Number(r.lastInsertRowid);
}
export function setRuleEnabled(id: number, enabled: boolean) { ensureSchema(); run('UPDATE alert_rules SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id); }
export function deleteRule(id: number) { ensureSchema(); transaction(() => { run('DELETE FROM alerts WHERE rule_id = ?', id); run('DELETE FROM alert_rules WHERE id = ?', id); }); }

export function listRules(): AlertRuleRow[] {
    ensureSchema();
    return all<{ id: number; name: string; enabled: number; created_ts: number; rule: string }>('SELECT * FROM alert_rules ORDER BY id').map(r => ({ ...r, rule: safe(r.rule) as AlertRule }));
}

export function listAlerts(limit = 100, ruleId?: number): AlertRow[] {
    ensureSchema();
    const rows = ruleId
        ? all<Record<string, unknown>>(`SELECT a.*, r.name rule_name, m.question, m.category FROM alerts a JOIN alert_rules r ON r.id = a.rule_id LEFT JOIN markets m ON m.condition_id = a.condition_id WHERE a.rule_id = ? ORDER BY a.ts DESC LIMIT ?`, ruleId, limit)
        : all<Record<string, unknown>>(`SELECT a.*, r.name rule_name, m.question, m.category FROM alerts a JOIN alert_rules r ON r.id = a.rule_id LEFT JOIN markets m ON m.condition_id = a.condition_id ORDER BY a.ts DESC LIMIT ?`, limit);
    return rows.map(r => ({ ...(r as unknown as AlertRow), signal_ids: (safe(r.signal_ids) as number[]) ?? [] }));
}

interface SigRow { id: number; type: string; ts: number; wallet: string | null; condition_id: string | null; outcome_index: number | null; score: number | null; payload: string | null; question: string | null; category: string | null; yes_price: number | null; is_sports: number | null; calibrated_roi: number | null; p_value: number | null; n_resolved: number | null }

function safe(v: unknown): unknown { if (typeof v !== 'string') return v ?? null; try { return JSON.parse(v); } catch { return null; } }
const numOr = (v: unknown, d: number | null = null) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Pure matcher (exported for tests). `others` = other signals on the same market, for requireAll. */
export function matches(rule: AlertRule, s: SigRow, others: SigRow[] = []): boolean {
    const p = (safe(s.payload) ?? {}) as Record<string, unknown>;
    if (rule.signalTypes?.length && !rule.signalTypes.includes(s.type)) return false;
    if (rule.minScore !== undefined && (s.score ?? -Infinity) < rule.minScore) return false;
    if (rule.categories?.length && !rule.categories.includes(s.category ?? '')) return false;
    if (rule.excludeSports && (s.is_sports === 1 || s.category === 'sports')) return false;
    if (rule.priceMin !== undefined && (s.yes_price === null || s.yes_price < rule.priceMin)) return false;
    if (rule.priceMax !== undefined && (s.yes_price === null || s.yes_price > rule.priceMax)) return false;
    if (s.wallet) {
        if (rule.walletMinCalibratedRoi !== undefined && (s.calibrated_roi === null || s.calibrated_roi < rule.walletMinCalibratedRoi)) return false;
        if (rule.walletMaxPValue !== undefined && (s.p_value === null || s.p_value > rule.walletMaxPValue)) return false;
        if (rule.walletMinResolved !== undefined && (s.n_resolved === null || s.n_resolved < rule.walletMinResolved)) return false;
    }
    if (rule.minUsdc !== undefined && (numOr(p.usdc) ?? -1) < rule.minUsdc) return false;
    if (rule.minEdge !== undefined) { const e = numOr(p.edge) ?? numOr(p.spread); if (e === null || e < rule.minEdge) return false; }
    if (rule.minGapCents !== undefined && (numOr(p.gapCents) ?? -1) < rule.minGapCents) return false;
    if (rule.minWallets !== undefined && (Array.isArray(p.wallets) ? p.wallets.length : 0) < rule.minWallets) return false;
    for (const req of rule.requireAll ?? []) {
        const w = req.withinMinutes * 60;
        if (!others.some(o => o.type === req.signalType && o.id !== s.id && Math.abs(o.ts - s.ts) <= w)) return false;
    }
    return true;
}

function summarize(rule: AlertRuleRow, s: SigRow, extra: SigRow[]): string {
    const p = (safe(s.payload) ?? {}) as Record<string, unknown>;
    const bits = [`[${rule.name}]`, s.type, s.score !== null ? `score ${Math.round(s.score)}` : '', s.question ? `“${s.question.slice(0, 80)}”` : '', s.yes_price !== null ? `@${Math.round(s.yes_price * 100)}¢` : ''];
    if (p.usdc !== undefined) bits.push(`$${Math.round(Number(p.usdc)).toLocaleString()}`);
    if (p.edge !== undefined || p.spread !== undefined) bits.push(`edge ${(Number(p.edge ?? p.spread) * 100).toFixed(2)}%`);
    if (p.gapCents !== undefined) bits.push(`gap ${p.gapCents}¢`);
    if (s.wallet) bits.push(`wallet ${s.wallet.slice(0, 10)}`);
    if (extra.length) bits.push(`+ ${extra.map(e => e.type).join(', ')}`);
    return bits.filter(Boolean).join(' ');
}

/** Evaluate all enabled rules against signals since `sinceTs`. Dedupes per (rule, market, outcome, day). */
export function evaluate(sinceTs: number = now() - 24 * 3600): AlertRow[] {
    ensureSchema();
    const rules = listRules().filter(r => r.enabled);
    if (!rules.length) return [];
    const sigs = all<SigRow>(
        `SELECT s.id, s.type, s.ts, s.wallet, s.condition_id, s.outcome_index, s.score, s.payload, m.question, m.category, m.yes_price, m.is_sports,
                ws.calibrated_roi, ws.p_value, ws.n_resolved
           FROM signals s LEFT JOIN markets m ON m.condition_id = s.condition_id
           LEFT JOIN wallet_scores ws ON ws.wallet = s.wallet AND ws.category = 'all' AND ws.window_days = 0
          WHERE s.ts >= ? ORDER BY s.ts`, sinceTs);
    const byMarket = new Map<string, SigRow[]>();
    for (const s of sigs) { const k = s.condition_id ?? `nomarket:${s.id}`; if (!byMarket.has(k)) byMarket.set(k, []); byMarket.get(k)!.push(s); }
    const created: AlertRow[] = [];
    transaction(() => {
        for (const rule of rules) {
            for (const s of sigs) {
                const others = byMarket.get(s.condition_id ?? `nomarket:${s.id}`) ?? [];
                if (!matches(rule.rule, s, others)) continue;
                const extra = (rule.rule.requireAll ?? []).flatMap(req => others.filter(o => o.type === req.signalType && o.id !== s.id && Math.abs(o.ts - s.ts) <= req.withinMinutes * 60).slice(0, 1));
                const ids = [s.id, ...extra.map(e => e.id)];
                const day = Math.floor(s.ts / 86400);
                const ev = (safe(s.payload) as Record<string, unknown> | null)?.event_slug;
                const key = s.condition_id ? `${rule.id}:m:${s.condition_id}:${s.outcome_index ?? 'x'}:${day}` : ev ? `${rule.id}:e:${String(ev)}:${day}` : `${rule.id}:s:${s.id}`;
                const r = run(`INSERT OR IGNORE INTO alerts(rule_id, ts, condition_id, outcome_index, wallet, signal_ids, summary, delivered, dedupe_key) VALUES (?,?,?,?,?,?,?,0,?)`,
                    rule.id, s.ts, s.condition_id, s.outcome_index, s.wallet, JSON.stringify(ids), summarize(rule, s, extra), key);
                if (Number(r.changes) > 0) created.push({ id: Number(r.lastInsertRowid), rule_id: rule.id, rule_name: rule.name, ts: s.ts, condition_id: s.condition_id, outcome_index: s.outcome_index, wallet: s.wallet, signal_ids: ids, summary: summarize(rule, s, extra), delivered: 0, question: s.question ?? undefined, category: s.category ?? undefined });
            }
        }
    });
    return created;
}

/** Send undelivered alerts to Telegram (if configured). Returns what was sent / printed. */
export async function deliver(opts: { print?: (m: string) => void; limit?: number } = {}): Promise<{ sent: number; pending: number; configured: boolean }> {
    ensureSchema();
    const print = opts.print ?? ((m: string) => console.log(m));
    const pending = all<{ id: number; summary: string; condition_id: string | null; ts: number }>('SELECT id, summary, condition_id, ts FROM alerts WHERE delivered = 0 ORDER BY ts DESC LIMIT ?', opts.limit ?? 50);
    const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
    const configured = Boolean(token && chat);
    let sent = 0;
    for (const a of pending) {
        const link = a.condition_id ? ` https://polymarket.com/event/${get<{ event_slug: string }>('SELECT event_slug FROM markets WHERE condition_id = ?', a.condition_id)?.event_slug ?? ''}` : '';
        const text = `${a.summary}${link}`;
        if (!configured) { print(`[alert pending] ${text}`); continue; }
        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) });
            if (res.ok) { run('UPDATE alerts SET delivered = 1, delivered_ts = ? WHERE id = ?', now(), a.id); sent++; }
            else print(`[alert] telegram ${res.status}: ${(await res.text()).slice(0, 120)}`);
        } catch (e) { print(`[alert] telegram error: ${(e as Error).message}`); }
    }
    return { sent, pending: pending.length - sent, configured };
}

/** Parse the /intel/alerts form into a rule. Exported for tests. */
export function ruleFromForm(f: Record<string, string | string[] | undefined>): AlertRule {
    const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);
    const numU = (v: string | string[] | undefined) => { const s = Array.isArray(v) ? v[0] : v; if (s === undefined || s === '') return undefined; const n = Number(s); return Number.isFinite(n) ? n : undefined; };
    const rule: AlertRule = {};
    const types = list(f.signalTypes); if (types.length) rule.signalTypes = types;
    const cats = list(f.categories); if (cats.length) rule.categories = cats;
    for (const k of ['minScore', 'priceMin', 'priceMax', 'walletMinCalibratedRoi', 'walletMaxPValue', 'walletMinResolved', 'minUsdc', 'minEdge', 'minGapCents', 'minWallets'] as const) { const n = numU(f[k]); if (n !== undefined) rule[k] = n; }
    if (f.excludeSports === 'on' || f.excludeSports === 'true') rule.excludeSports = true;
    const reqType = Array.isArray(f.requireType) ? f.requireType[0] : f.requireType; const reqMin = numU(f.requireWithinMinutes);
    if (reqType) rule.requireAll = [{ signalType: reqType, withinMinutes: reqMin ?? 60 }];
    return rule;
}

export const SIGNAL_TYPES = ['consensus', 'divergence', 'fade', 'insider', 'arb_multi_outcome', 'arb_ladder', 'arb_logical', 'arb_cross_venue', 'thin_move', 'spoof_suspect', 'comment_spike', 'talk_wallet_divergence', 'leak_phrase', 'shill_cluster', 'early_resolution', 'rules_changed', 'source_changed'];
