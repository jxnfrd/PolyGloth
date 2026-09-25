import { recentSignals } from '@/lib/ui/queries';
import { openDb, all } from '@/lib/pm/db';
import { Table, H, MarketLink, fmtUsd, fmtCents, ago, Empty, Pill, fmtPct, fmtTs, Sentence, Term } from '@/components/intel/ui';
import { describeSignal } from '@/lib/ui/explain';

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
            <H sub="price jumped 8¢ or more in an hour on under 2% of the day's volume; such moves often snap back">Thin moves</H>
            {thin.length === 0 ? <Empty>No thin moves in the markets scanned. This check runs on the 20 most active markets each cycle.</Empty> :
            <Table head={['when', 'what happened', 'market']}
                rows={thin.map(r => [ago(r.ts), <Sentence key="s">{describeSignal(r as never)}</Sentence>, <MarketLink key="m" conditionId={r.condition_id} question="open" />])} />}
            <H sub="a large resting order appeared and vanished without trading">Vanishing walls</H>
            <Table head={['when', 'what happened', 'market']}
                rows={spoof.map(r => [ago(r.ts), <Sentence key="s">{describeSignal(r as never)}</Sentence>, <MarketLink key="m" conditionId={r.condition_id} question="open" />])}
                empty="None detected. This needs hourly order-book snapshots, which the scheduler collects once it runs." />
            <H sub="markets priced 93¢+ or 7¢- that end within two weeks, and what holding the likely side to $1 would earn. A fat yield usually means the market is not as certain as it looks: check its rules first.">Last cents</H>
            <Table head={['market', 'category', 'likely side', 'bid/ask', <Term key="y" k="last-cents yield">yield to $1</Term>, 'days left', 'annualised', '24h volume', 'liquidity', 'ends']}
                rows={drift.map(m => { const y = Number(m.gross_yield), d = Math.max(1, Number(m.days_left)); return [<MarketLink key="m" conditionId={m.condition_id} question={m.question} slug={m.event_slug} />, String(m.category), <Pill key="s" tone={m.side === 'YES' ? 'emerald' : 'rose'}>{String(m.side)}</Pill>, `${fmtCents(m.best_bid)}/${fmtCents(m.best_ask)}`, fmtPct(y, 2), d.toFixed(1), fmtPct(y * 365 / d, 0), fmtUsd(m.volume24hr), fmtUsd(m.liquidity), fmtTs(m.end_ts).slice(0, 10)]; })}
                empty="No near-certain markets with a live two-sided book in the store." />
        </div>
    );
}
