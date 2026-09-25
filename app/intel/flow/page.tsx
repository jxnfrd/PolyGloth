import { recentSignals } from '@/lib/ui/queries';
import { openDb, all } from '@/lib/pm/db';
import { Table, H, MarketLink, fmtUsd, fmtCents, ago, Empty, Pill, fmtPct, fmtTs } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type P = Record<string, unknown>;
const p = (r: Record<string, unknown>) => (r.payload ?? {}) as P;

function driftCandidates() {
    openDb();
    const t = Math.floor(Date.now() / 1000);
    return all<Record<string, unknown>>(
        `SELECT condition_id, question, event_slug, category, yes_price, best_bid, best_ask, end_ts, volume24hr, liquidity,
                CASE WHEN yes_price >= 0.93 THEN 'YES' ELSE 'NO' END side,
                CASE WHEN yes_price >= 0.93 THEN (1 - COALESCE(best_ask, yes_price)) / COALESCE(best_ask, yes_price) ELSE (COALESCE(best_bid, yes_price)) / (1 - COALESCE(best_bid, yes_price)) END gross_yield,
                MAX(1.0, (end_ts - ?) / 86400.0) days_left
           FROM markets WHERE resolved = 0 AND closed = 0 AND active = 1 AND is_sports = 0 AND end_ts > ? AND end_ts < ? AND (yes_price >= 0.93 OR yes_price <= 0.07) AND liquidity > 5000 AND best_bid IS NOT NULL AND best_ask IS NOT NULL
          ORDER BY gross_yield / days_left DESC LIMIT 40`, t, t + 6 * 3600, t + 14 * 86400);
}

export default function Flow() {
    const thin = recentSignals('thin_move', 100), spoof = recentSignals('spoof_suspect', 50);
    const drift = driftCandidates();
    return (
        <div>
            <H sub="≥8¢ move in 60 min on < 2% of 24h volume: candidates for a fade of half the move">Thin moves</H>
            {thin.length === 0 ? <Empty>No thin-move signals stored. Run <code>npx tsx scripts/pm-flow.ts top 8</code>. Needs market-level trades (pm-insider scan ingests them).</Empty> :
            <Table head={['when', 'market', 'move', 'window vol', '24h vol', 'fade side', 'score']}
                rows={thin.map(r => [ago(r.ts), <MarketLink key="m" conditionId={r.condition_id} question={r.question} />, `${Number(p(r).moveCents) > 0 ? '+' : ''}${Number(p(r).moveCents).toFixed(0)}¢`, fmtUsd(p(r).windowUsd ?? p(r).volumeUsd), fmtUsd(p(r).volume24hr), <Pill key="s" tone={p(r).fadeSide === 'YES' ? 'emerald' : 'rose'}>{String(p(r).fadeSide)}</Pill>, r.score])} />}
            <H sub="large resting levels that vanished between two snapshots without trading">Spoof suspects</H>
            <Table head={['when', 'market', 'side', 'price', 'size', 'vs median level']}
                rows={spoof.map(r => [ago(r.ts), <MarketLink key="m" conditionId={r.condition_id} question={r.question} />, String(p(r).side), fmtCents(p(r).price), fmtUsd(p(r).size), `${(Number(p(r).size) / Math.max(1, Number(p(r).medianLevelSize))).toFixed(0)}×`])}
                empty="No spoof signals. Needs paired book snapshots (scripts/pm-daemon.ts books job)." />
            <H sub="non-sports near-certain markets ending in 6h–14d: gross yield of holding the likely side to $1, annualized (days floored at 1). A fat yield usually means the market is NOT certain: check /intel/resolution first.">Resolution drift (last-cents yield)</H>
            <Table head={['market', 'cat', 'side', 'bid/ask', 'gross yield', 'days left', 'annualized', '24h vol', 'liquidity', 'ends']}
                rows={drift.map(m => { const y = Number(m.gross_yield), d = Math.max(1, Number(m.days_left)); return [<MarketLink key="m" conditionId={m.condition_id} question={m.question} slug={m.event_slug} />, String(m.category), <Pill key="s" tone={m.side === 'YES' ? 'emerald' : 'rose'}>{String(m.side)}</Pill>, `${fmtCents(m.best_bid)}/${fmtCents(m.best_ask)}`, fmtPct(y, 2), d.toFixed(1), fmtPct(y * 365 / d, 0), fmtUsd(m.volume24hr), fmtUsd(m.liquidity), fmtTs(m.end_ts).slice(0, 10)]; })}
                empty="No near-certain markets with a live two-sided book in the store." />
        </div>
    );
}
