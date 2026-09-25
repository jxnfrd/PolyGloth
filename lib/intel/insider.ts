/**
 * Insider / fresh-wallet detection (Phase 2, spec §4).
 *
 * Works on market-level trade tapes (every wallet that traded a market), pulled with
 * ingestMarketTrades. Wallet age is established by fetching that wallet's newest 500 trades once:
 * if fewer than 500 come back the oldest one IS the first trade; if 500 come back the wallet has
 * ≥500 trades and is not fresh. Results are cached in `insider_wallets`.
 *
 * Suspicion score 0–10 = sum of reason weights, capped:
 *   fresh_big 4 · niche 2 · sniper 2 · one_and_done 2 · improbable_record 3
 */
import { openDb, all, get, run, stmt, transaction, now } from '../pm/db';
import { ingestMarketTrades, Logger } from '../pm/ingest';
import { walletTrades } from '../pm/data-api';

export function ensureSchema() {
    openDb();
    stmt(`CREATE TABLE IF NOT EXISTS insider_wallets (address TEXT PRIMARY KEY, first_ts INTEGER, n_trades_seen INTEGER, complete INTEGER, checked_at INTEGER)`).run();
    stmt(`CREATE TABLE IF NOT EXISTS insider_flags (trade_id TEXT PRIMARY KEY, signal_id INTEGER, created_at INTEGER)`).run();
}

export const WEIGHTS = { fresh_big: 4, niche: 2, sniper: 2, one_and_done: 2, improbable_record: 3 } as const;
export type Reason = keyof typeof WEIGHTS;

export interface WalletAge { address: string; firstTs: number | null; nTradesSeen: number; complete: boolean }

export async function walletAge(address: string, maxAgeSec = 6 * 3600): Promise<WalletAge> {
    ensureSchema();
    const a = address.toLowerCase();
    const cached = get<{ first_ts: number | null; n_trades_seen: number; complete: number; checked_at: number }>('SELECT first_ts, n_trades_seen, complete, checked_at FROM insider_wallets WHERE address = ?', a);
    if (cached && now() - cached.checked_at < maxAgeSec) return { address: a, firstTs: cached.first_ts, nTradesSeen: cached.n_trades_seen, complete: Boolean(cached.complete) };
    const known = get<{ first_trade_ts: number | null; trade_count: number; trades_complete: number }>('SELECT first_trade_ts, trade_count, trades_complete FROM wallets WHERE address = ? AND trade_count > 0', a);
    let firstTs: number | null = null, n = 0, complete = false;
    if (known && known.trades_complete) { firstTs = known.first_trade_ts; n = known.trade_count; complete = true; }
    else {
        const ts = await walletTrades(a, 500);
        n = ts.length; complete = ts.length < 500;
        firstTs = ts.length ? Math.min.apply(null, ts.map(t => t.timestamp)) : null;
    }
    stmt('INSERT OR REPLACE INTO insider_wallets(address, first_ts, n_trades_seen, complete, checked_at) VALUES (?,?,?,?,?)').run(a, firstTs, n, complete ? 1 : 0, now());
    return { address: a, firstTs, nTradesSeen: n, complete };
}

export interface Flag { trade_id: string; wallet: string; condition_id: string; outcome_index: number; question: string; ts: number; price: number; usdc: number; reasons: Reason[]; score: number; wallet_age_h: number | null; market_vol24: number; share_of_vol24: number; cluster_wallets?: number }

interface TapeRow { id: string; wallet: string; condition_id: string; outcome_index: number; side: string; price: number; usdc: number; ts: number; title: string }

/** Pure detector over one market's tape. `ages` must contain every wallet in `tape` that you want age-based reasons for. */
export function detectInMarket(tape: TapeRow[], market: { condition_id: string; question: string; volume24hr: number }, ages: Record<string, WalletAge>, scores: Record<string, { p_value: number | null; n_resolved: number }>, o: { minUsd?: number; clusterMinUsd?: number; clusterWindowSec?: number; clusterMinWallets?: number; maxPrice?: number } = {}): Flag[] {
    const minUsd = o.minUsd ?? 1000, cMin = o.clusterMinUsd ?? 500, cWin = o.clusterWindowSec ?? 600, cN = o.clusterMinWallets ?? 3, maxPrice = o.maxPrice ?? 0.95;
    const vol = market.volume24hr || 0;
    // Buying above maxPrice (e.g. 99.8¢) is yield harvesting on a decided market, not an informed bet: never flag it.
    const buys = tape.filter(t => t.side === 'BUY' && t.price <= maxPrice).sort((a, b) => a.ts - b.ts);
    // sniper clusters: sliding window per outcome
    const clusterOf: Record<string, number> = {};
    const byOutcome: Record<number, TapeRow[]> = {};
    for (const t of buys) { if (t.usdc >= cMin) (byOutcome[t.outcome_index] = byOutcome[t.outcome_index] || []).push(t); }
    for (const k of Object.keys(byOutcome)) {
        const arr = byOutcome[Number(k)];
        for (let i = 0; i < arr.length; i++) {
            const seen: Record<string, true> = {}; let j = i;
            while (j < arr.length && arr[j].ts - arr[i].ts <= cWin) { seen[arr[j].wallet] = true; j++; }
            const nW = Object.keys(seen).length;
            if (nW < cN) continue;
            // 2026-09-25 audit: 119 of 134 flags were "snipers" on $350k/day Fed markets, where 3 wallets buying the same
            // side inside 10 minutes is ordinary trading. A cluster only counts when it is material for the market
            // (≥ 2 % of 24h volume, or the market is thin) AND at least two members are young wallets (≤ 7 days, complete history).
            const members = arr.slice(i, j);
            const clusterUsd = members.reduce((acc, t) => acc + t.usdc, 0);
            const material = vol === 0 || vol < 100_000 || clusterUsd >= 0.02 * vol;
            const young = Object.keys(seen).filter(w => { const a = ages[w]; return a && a.complete && a.firstTs && (arr[i].ts - a.firstTs) / 86400 <= 7; }).length;
            if (!material || young < 2) continue;
            for (let q = i; q < j; q++) clusterOf[arr[q].id] = Math.max(clusterOf[arr[q].id] || 0, nW);
        }
    }
    const flags: Flag[] = [];
    for (const t of buys) {
        const reasons: Reason[] = [];
        const age = ages[t.wallet];
        // firstTs is only the true first trade when the history was complete (< 500 trades); otherwise age is unknown (but ≥ 500 trades → not fresh).
        const ageH = age && age.complete && age.firstTs ? (t.ts - age.firstTs) / 3600 : null;
        const big = t.usdc >= minUsd || (vol > 0 && t.usdc >= 0.02 * vol);
        if (age && age.complete && ageH !== null && ageH <= 48 && big) reasons.push('fresh_big');
        if (vol > 0 && vol < 50_000 && t.usdc >= 0.05 * vol) reasons.push('niche');
        if (clusterOf[t.id]) reasons.push('sniper');
        if (age && age.complete && age.nTradesSeen <= 3) reasons.push('one_and_done');
        const s = scores[t.wallet];
        if (s && s.p_value !== null && s.p_value < 0.05 && s.n_resolved >= 30) reasons.push('improbable_record');
        if (!reasons.length) continue;
        const score = Math.min(10, reasons.reduce((a, r) => a + WEIGHTS[r], 0));
        flags.push({ trade_id: t.id, wallet: t.wallet, condition_id: t.condition_id, outcome_index: t.outcome_index, question: market.question, ts: t.ts, price: t.price, usdc: t.usdc, reasons, score, wallet_age_h: ageH, market_vol24: vol, share_of_vol24: vol ? t.usdc / vol : 0, cluster_wallets: clusterOf[t.id] });
    }
    return flags.sort((a, b) => b.score - a.score || b.usdc - a.usdc);
}

export function persistFlags(flags: Flag[]): number {
    ensureSchema();
    let n = 0;
    transaction(() => {
        for (const f of flags) {
            if (get('SELECT 1 FROM insider_flags WHERE trade_id = ?', f.trade_id)) continue;
            const r = run('INSERT INTO signals(type, ts, wallet, condition_id, outcome_index, score, payload) VALUES (?,?,?,?,?,?,?)', 'insider', f.ts, f.wallet, f.condition_id, f.outcome_index, f.score, JSON.stringify(f));
            run('INSERT INTO insider_flags(trade_id, signal_id, created_at) VALUES (?,?,?)', f.trade_id, Number(r.lastInsertRowid), now());
            n++;
        }
    });
    return n;
}

/** Scan markets: pull tapes, establish ages for candidate wallets, detect, persist. */
export async function scan(o: { conditionIds?: string[]; limit?: number; days?: number; maxTrades?: number; minUsd?: number; log?: Logger } = {}): Promise<{ markets: number; flags: number; flagsList: Flag[] }> {
    ensureSchema();
    const log = o.log ?? (() => {});
    const ids = o.conditionIds ?? all<{ condition_id: string }>(`SELECT condition_id FROM markets WHERE is_sports = 0 AND active = 1 AND closed = 0 AND (event_slug NOT LIKE '%updown%') ORDER BY volume24hr DESC LIMIT ?`, o.limit ?? 30).map(r => r.condition_id);
    const since = now() - (o.days ?? 3) * 86_400;
    const out: Flag[] = [];
    for (const cid of ids) {
        try { await ingestMarketTrades(cid, o.maxTrades ?? 2000, log); } catch (e) { log(`tape ${cid.slice(0, 10)}: ${(e as Error).message}`); continue; }
        const m = get<{ condition_id: string; question: string; volume24hr: number }>('SELECT condition_id, question, volume24hr FROM markets WHERE condition_id = ?', cid);
        if (!m) continue;
        const tape = all<TapeRow>('SELECT id, wallet, condition_id, outcome_index, side, price, usdc, ts, title FROM trades WHERE condition_id = ? AND ts >= ? ORDER BY ts ASC', cid, since);
        // ages only for wallets whose trade is large enough to matter (limits API calls)
        const thresh = Math.min(o.minUsd ?? 1000, 0.02 * (m.volume24hr || 0) || Infinity);
        const cand: Record<string, true> = {};
        for (const t of tape) if (t.side === 'BUY' && t.usdc >= Math.min(500, thresh)) cand[t.wallet] = true;
        const ages: Record<string, WalletAge> = {};
        for (const w of Object.keys(cand)) { try { ages[w] = await walletAge(w); } catch (e) { log(`age ${w.slice(0, 10)}: ${(e as Error).message}`); } }
        const scores: Record<string, { p_value: number | null; n_resolved: number }> = {};
        for (const r of all<{ wallet: string; p_value: number | null; n_resolved: number }>(`SELECT wallet, p_value, n_resolved FROM wallet_scores WHERE category = 'all' AND window_days = 0`)) scores[r.wallet] = r;
        const flags = detectInMarket(tape, m, ages, scores, { minUsd: o.minUsd });
        const n = persistFlags(flags);
        log(`${m.question.slice(0, 50)}: ${tape.length} trades, ${Object.keys(cand).length} wallets aged, ${flags.length} flags (${n} new)`);
        out.push(...flags);
    }
    return { markets: ids.length, flags: out.length, flagsList: out };
}

export interface LedgerRow { reason: string; n: number; resolved: number; wins: number; hit_rate: number | null }

/** Hit rate of past flags per reason, once markets resolved (ingestResolutions fills signals.outcome). */
export function ledger(): LedgerRow[] {
    ensureSchema();
    const rows = all<{ payload: string; outcome: string | null }>(`SELECT payload, outcome FROM signals WHERE type = 'insider'`);
    const acc: Record<string, LedgerRow> = {};
    for (const r of rows) {
        let reasons: string[] = []; try { reasons = JSON.parse(r.payload).reasons || []; } catch { /* ignore */ }
        for (const rs of reasons) {
            const a = acc[rs] || (acc[rs] = { reason: rs, n: 0, resolved: 0, wins: 0, hit_rate: null });
            a.n++; if (r.outcome) { a.resolved++; if (r.outcome === 'WIN') a.wins++; }
        }
    }
    const out = Object.keys(acc).map(k => acc[k]); for (const a of out) a.hit_rate = a.resolved ? a.wins / a.resolved : null;
    return out;
}

/** How far the market has moved since a flagged trade (positive = moved the flag's way). */
export function priceImpact(signalId: number): { moved_pp: number; from: number; to: number } | null {
    ensureSchema();
    const s = get<{ condition_id: string; outcome_index: number; payload: string }>('SELECT condition_id, outcome_index, payload FROM signals WHERE id = ?', signalId);
    if (!s) return null;
    const m = get<{ yes_price: number | null }>('SELECT yes_price FROM markets WHERE condition_id = ?', s.condition_id);
    if (!m || m.yes_price === null) return null;
    const from = JSON.parse(s.payload).price as number;
    const to = s.outcome_index === 0 ? m.yes_price : 1 - m.yes_price;
    return { moved_pp: (to - from) * 100, from, to };
}

/** Funding-chain tracing needs Polygonscan (POLYGONSCAN_API_KEY): USDC transfers into `address` → source wallets. Not wired. */
export async function traceFunding(_address: string): Promise<null> { return null; }
