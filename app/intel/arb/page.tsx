import { recentSignals } from '@/lib/ui/queries';
import { Table, H, MarketLink, fmtPct, fmtUsd, ago, Empty, fmtCents, Sentence } from '@/components/intel/ui';
import { describeSignal } from '@/lib/ui/explain';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type P = Record<string, unknown>;
const p = (r: Record<string, unknown>) => (r.payload ?? {}) as P;
const n = (v: unknown) => Number(v);
const LEG: Record<string, string> = { buy_yes_pm_buy_no_kalshi: 'buy YES on Polymarket + buy NO on Kalshi', buy_no_pm_buy_yes_kalshi: 'buy NO on Polymarket + buy YES on Kalshi' };

export default function Arb() {
    const multi = recentSignals('arb_multi_outcome', 50), ladder = recentSignals('arb_ladder', 100), logical = recentSignals('arb_logical', 50), venue = recentSignals('arb_cross_venue', 50);
    const none = !multi.length && !ladder.length && !logical.length && !venue.length;
    return (
        <div>
            {none && <Empty>No price inconsistencies found in the last scan.</Empty>}
            <H sub="one-winner events where buying every outcome costs less than the $1 it pays out">Outcomes that add up to less than $1</H>
            <Table head={['when', 'in plain words', 'event', 'buy', 'total cost', 'edge', 'legs', 'max size']}
                rows={multi.map(r => [ago(r.ts), <Sentence key="s">{describeSignal(r as never)}</Sentence>, <a key="e" className="text-sky-300 hover:underline" href={`https://polymarket.com/event/${p(r).event_slug}`} target="_blank" rel="noreferrer">{String(p(r).event_slug)}</a>, p(r).kind === 'all_yes' ? 'buy every YES' : 'buy every NO', n(p(r).sumAsk).toFixed(3), fmtPct(n(p(r).edge) / Math.max(1e-9, n(p(r).sumAsk)), 2), String(p(r).legs), p(r).maxSizeUsd == null ? '— (run --live)' : fmtUsd(p(r).maxSizeUsd)])} />
            <H sub="a higher bar can never be more likely than a lower one on the same number; these pairs are the wrong way round">Ladders priced the wrong way round</H>
            <Table head={['when', 'in plain words', 'lower bar', 'price', 'higher bar', 'price', 'gap']}
                rows={ladder.map(r => { const lo = (p(r).lower ?? {}) as P, hi = (p(r).higher ?? {}) as P; return [ago(r.ts), <Sentence key="s">{describeSignal(r as never)}</Sentence>, <MarketLink key="l" conditionId={lo.condition_id} question={lo.question} />, fmtCents(lo.pYes ?? lo.yes_price), <MarketLink key="h" conditionId={hi.condition_id} question={hi.question} />, fmtCents(hi.pYes ?? hi.yes_price), fmtCents(p(r).spread)]; })} />
            <H sub="an earlier deadline cannot be likelier than a later one; winning the presidency cannot be likelier than the nomination">Logic priced the wrong way round</H>
            <Table head={['when', 'in plain words', 'narrower', 'price', 'broader', 'price', 'gap']}
                rows={logical.map(r => { const a = (p(r).narrower ?? {}) as P, b = (p(r).broader ?? {}) as P; return [ago(r.ts), <Sentence key="s">{describeSignal(r as never)}</Sentence>, <MarketLink key="a" conditionId={a.condition_id} question={a.question} />, fmtCents(a.pYes ?? a.yes_price), <MarketLink key="b" conditionId={b.condition_id} question={b.question} />, fmtCents(b.pYes ?? b.yes_price), fmtCents(p(r).spread)]; })} />
            <H sub="the same question is cheaper on one venue than the other, after Kalshi's fee. Read both rule texts first: same-day Bitcoin markets settle at different hours on the two venues.">Polymarket vs Kalshi</H>
            <Table head={['when', 'in plain words', 'kalshi ticker', 'total cost', 'edge', 'title match']}
                rows={venue.map(r => [ago(r.ts), <Sentence key="s">{describeSignal(r as never)} <MarketLink conditionId={r.condition_id} question="open" /></Sentence>, <a key="k" className="text-sky-300 hover:underline" href={`https://kalshi.com/markets/${String(p(r).ticker).split('-')[0].toLowerCase()}`} target="_blank" rel="noreferrer">{String(p(r).ticker)}</a>, n(p(r).cost).toFixed(3), fmtPct(p(r).edge, 2), fmtPct(p(r).confidence, 0)])} />
        </div>
    );
}
