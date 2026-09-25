import { openDb, all, get, now, kvSet, kvGet } from '../pm/db';

/**
 * Weekly edge report (mega-list 13.30): last 7 days vs the prior 7. Everything comes from the local store;
 * hit rates use `signals.outcome` (filled by ingestResolutions when the market resolves).
 */

export interface SignalStat { type: string; n: number; nPrev: number; resolved: number; hitRate: number | null; hitRatePrev: number | null; decayed: boolean }
export interface WalletFlip { wallet: string; username: string | null; roi30: number; roi90: number; direction: 'improving' | 'fading' }
export interface EdgeReport {
    generatedTs: number; from: number; to: number; prevFrom: number;
    signals: SignalStat[];
    decayed: SignalStat[];
    walletsFlipped: WalletFlip[];
    consensusTop: { condition_id: string; question: string | null; outcome_index: number | null; score: number | null; wallets: number; usdc: number; ts: number }[];
    arb: { n: number; nPrev: number; bestEdge: number | null; bestType: string | null; bestQuestion: string | null };
    paper: { strategy: string; n: number; pnl: number; staked: number; wins: number; resolved: number }[];
    insider: { flags: number; resolved: number; hitRate: number | null };
    commentSpikes: { condition_id: string; question: string | null; z: number; ts: number }[];
    dataFreshness: { lastTradeTs: number | null; lastScoreTs: number | null; resolvedMarkets: number };
}

const safe = (v: unknown): Record<string, unknown> => { if (typeof v !== 'string') return {}; try { return JSON.parse(v) ?? {}; } catch { return {}; } };

export function build(toTs: number = now(), days = 7): EdgeReport {
    openDb();
    const from = toTs - days * 86400, prevFrom = from - days * 86400;
    const cur = all<{ type: string; n: number; resolved: number; wins: number }>(`SELECT type, COUNT(*) n, SUM(CASE WHEN outcome IN ('WIN','LOSS') THEN 1 ELSE 0 END) resolved, SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) wins FROM signals WHERE ts >= ? AND ts < ? GROUP BY type`, from, toTs);
    const prev = all<{ type: string; n: number; resolved: number; wins: number }>(`SELECT type, COUNT(*) n, SUM(CASE WHEN outcome IN ('WIN','LOSS') THEN 1 ELSE 0 END) resolved, SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) wins FROM signals WHERE ts >= ? AND ts < ? GROUP BY type`, prevFrom, from);
    const prevMap = new Map(prev.map(p => [p.type, p]));
    const types = Array.from(new Set([...cur.map(c => c.type), ...prev.map(p => p.type)])).sort();
    const signals: SignalStat[] = types.map(type => {
        const c = cur.find(x => x.type === type), p = prevMap.get(type);
        const hit = c && c.resolved ? c.wins / c.resolved : null, hitPrev = p && p.resolved ? p.wins / p.resolved : null;
        return { type, n: c?.n ?? 0, nPrev: p?.n ?? 0, resolved: c?.resolved ?? 0, hitRate: hit, hitRatePrev: hitPrev, decayed: hit !== null && hitPrev !== null && (c?.resolved ?? 0) >= 5 && (p?.resolved ?? 0) >= 5 && hitPrev - hit >= 0.15 };
    }).sort((a, b) => b.n - a.n);

    const flips = all<{ wallet: string; username: string | null; roi30: number; roi90: number }>(
        `SELECT a.wallet, w.username, a.calibrated_roi roi30, b.calibrated_roi roi90 FROM wallet_scores a JOIN wallet_scores b ON b.wallet = a.wallet AND b.category = 'all' AND b.window_days = 90
           LEFT JOIN wallets w ON w.address = a.wallet WHERE a.category = 'all' AND a.window_days = 30 AND a.n_resolved >= 10 AND b.n_resolved >= 20
           AND ((a.calibrated_roi > 0 AND b.calibrated_roi < 0) OR (a.calibrated_roi < 0 AND b.calibrated_roi > 0)) ORDER BY ABS(a.calibrated_roi - b.calibrated_roi) DESC LIMIT 20`);
    const walletsFlipped: WalletFlip[] = flips.map(f => ({ ...f, direction: f.roi30 > f.roi90 ? 'improving' : 'fading' }));

    const consensusTop = all<{ condition_id: string; question: string | null; outcome_index: number | null; score: number | null; payload: string; ts: number }>(
        `SELECT s.condition_id, m.question, s.outcome_index, s.score, s.payload, s.ts FROM signals s LEFT JOIN markets m ON m.condition_id = s.condition_id WHERE s.type = 'consensus' AND s.ts >= ? ORDER BY s.score DESC, s.ts DESC LIMIT 10`, from)
        .map(r => { const p = safe(r.payload); return { condition_id: r.condition_id, question: r.question, outcome_index: r.outcome_index, score: r.score, wallets: Array.isArray(p.wallets) ? p.wallets.length : 0, usdc: Number(p.usdc ?? 0), ts: r.ts }; });

    const arbRows = all<{ type: string; payload: string; question: string | null }>(`SELECT s.type, s.payload, m.question FROM signals s LEFT JOIN markets m ON m.condition_id = s.condition_id WHERE s.type LIKE 'arb_%' AND s.ts >= ?`, from);
    let best: { edge: number; type: string; question: string | null } | null = null;
    for (const r of arbRows) { const p = safe(r.payload); const e = Number(p.edge ?? p.spread ?? NaN); if (Number.isFinite(e) && (!best || e > best.edge)) best = { edge: e, type: r.type, question: r.question ?? (p.question as string | undefined) ?? (p.event_slug as string | undefined) ?? null }; }
    const arbPrev = get<{ n: number }>(`SELECT COUNT(*) n FROM signals WHERE type LIKE 'arb_%' AND ts >= ? AND ts < ?`, prevFrom, from)?.n ?? 0;

    const paper = all<{ strategy: string; n: number; pnl: number; staked: number; wins: number; resolved: number }>(
        `SELECT strategy, COUNT(*) n, SUM(COALESCE(pnl,0)) pnl, SUM(usd) staked, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) wins, SUM(CASE WHEN status IN ('closed','resolved') THEN 1 ELSE 0 END) resolved FROM paper_orders WHERE status != 'rejected' AND COALESCE(close_ts, ts) >= ? GROUP BY strategy ORDER BY pnl DESC`, from);

    const ins = get<{ flags: number; resolved: number; wins: number }>(`SELECT COUNT(*) flags, SUM(CASE WHEN outcome IN ('WIN','LOSS') THEN 1 ELSE 0 END) resolved, SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) wins FROM signals WHERE type = 'insider'`);
    const insider = { flags: ins?.flags ?? 0, resolved: ins?.resolved ?? 0, hitRate: ins && ins.resolved ? ins.wins / ins.resolved : null };

    const commentSpikes = all<{ condition_id: string; question: string | null; payload: string; ts: number }>(`SELECT s.condition_id, m.question, s.payload, s.ts FROM signals s LEFT JOIN markets m ON m.condition_id = s.condition_id WHERE s.type = 'comment_spike' AND s.ts >= ? ORDER BY s.score DESC LIMIT 10`, from)
        .map(r => ({ condition_id: r.condition_id, question: r.question, z: Number(safe(r.payload).z ?? 0), ts: r.ts }));

    const dataFreshness = { lastTradeTs: get<{ t: number | null }>('SELECT MAX(ts) t FROM trades')?.t ?? null, lastScoreTs: get<{ t: number | null }>('SELECT MAX(computed_at) t FROM wallet_scores')?.t ?? null, resolvedMarkets: get<{ n: number }>('SELECT COUNT(*) n FROM markets WHERE resolved = 1')?.n ?? 0 };

    return { generatedTs: toTs, from, to: toTs, prevFrom, signals, decayed: signals.filter(s => s.decayed), walletsFlipped, consensusTop, arb: { n: arbRows.length, nPrev: arbPrev, bestEdge: best?.edge ?? null, bestType: best?.type ?? null, bestQuestion: best?.question ?? null }, paper, insider, commentSpikes, dataFreshness };
}

const d = (ts: number | null) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '—');
const pct = (v: number | null, digits = 0) => (v === null ? '—' : `${(v * 100).toFixed(digits)}%`);
const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;

export function toMarkdown(r: EdgeReport): string {
    const L: string[] = [];
    L.push(`# Edge report ${d(r.from)} → ${d(r.to)}`, '', `Generated ${new Date(r.generatedTs * 1000).toISOString()}. Prior window ${d(r.prevFrom)} → ${d(r.from)}. Store: last trade ${d(r.dataFreshness.lastTradeTs)}, scores ${d(r.dataFreshness.lastScoreTs)}, ${r.dataFreshness.resolvedMarkets.toLocaleString()} resolved markets.`, '');
    L.push('## Signals', '', '| type | this week | prior | resolved | hit rate | prior hit | decayed |', '|---|---|---|---|---|---|---|');
    for (const s of r.signals) L.push(`| ${s.type} | ${s.n} | ${s.nPrev} | ${s.resolved} | ${pct(s.hitRate)} | ${pct(s.hitRatePrev)} | ${s.decayed ? '**yes**' : ''} |`);
    if (!r.signals.length) L.push('| (none) | | | | | | |');
    L.push('', `## Decayed signals`, '', r.decayed.length ? r.decayed.map(s => `- ${s.type}: ${pct(s.hitRatePrev)} → ${pct(s.hitRate)}`).join('\n') : '_none (needs ≥5 resolved signals in both windows)_');
    L.push('', '## Wallets whose edge flipped (30d vs 90d calibrated ROI)', '');
    L.push(r.walletsFlipped.length ? r.walletsFlipped.map(w => `- ${w.username || w.wallet.slice(0, 10)}: ${pct(w.roi90, 1)} → ${pct(w.roi30, 1)} (${w.direction})`).join('\n') : '_none_');
    L.push('', '## Consensus markets (smart wallets stacking one side)', '');
    L.push(r.consensusTop.length ? r.consensusTop.map(c => `- ${c.question ?? c.condition_id.slice(0, 12)} · side ${c.outcome_index} · ${c.wallets} wallets · ${usd(c.usdc)}`).join('\n') : '_none_');
    L.push('', '## Arbitrage', '', `${r.arb.n} arb signals (prior ${r.arb.nPrev}). Best: ${r.arb.bestEdge === null ? '—' : `${(r.arb.bestEdge * 100).toFixed(2)}% ${r.arb.bestType} on ${r.arb.bestQuestion ?? '?'}`}`);
    L.push('', '## Paper P/L by strategy', '', '| strategy | orders | resolved | wins | staked | P/L |', '|---|---|---|---|---|---|');
    for (const p of r.paper) L.push(`| ${p.strategy} | ${p.n} | ${p.resolved} | ${p.wins} | ${usd(p.staked)} | ${usd(p.pnl)} |`);
    if (!r.paper.length) L.push('| (none) | | | | | |');
    L.push('', '## Insider ledger', '', `${r.insider.flags} flags, ${r.insider.resolved} resolved, hit rate ${pct(r.insider.hitRate)}`);
    L.push('', '## Comment spikes', '', r.commentSpikes.length ? r.commentSpikes.map(c => `- ${c.question ?? c.condition_id.slice(0, 12)} (z=${c.z.toFixed(1)})`).join('\n') : '_none_', '');
    return L.join('\n');
}

export function saveLatest(r: EdgeReport) { kvSet('edge_report_latest', r); }
export function latest(): EdgeReport | null { openDb(); return kvGet<EdgeReport>('edge_report_latest'); }
