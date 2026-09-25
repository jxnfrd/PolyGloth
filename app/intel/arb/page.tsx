import { recentSignals } from '@/lib/ui/queries';
import { Table, H, MarketLink, fmtPct, fmtUsd, ago, Empty, fmtCents } from '@/components/intel/ui';

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
            {none && <Empty>No arbitrage signals stored yet. Run <code>npx tsx scripts/pm-arb.ts</code> (add <code>--live</code> to size against live books).</Empty>}
            <H sub="neg-risk events: buy every YES for less than $1, or every NO for less than N−1; legs require a two-sided book">Multi-outcome sum</H>
            <Table head={['when', 'event', 'kind', 'sum of asks', 'edge', 'legs', 'max size']}
                rows={multi.map(r => [ago(r.ts), <a key="e" className="text-sky-300 hover:underline" href={`https://polymarket.com/event/${p(r).event_slug}`} target="_blank" rel="noreferrer">{String(p(r).event_slug)}</a>, p(r).kind === 'all_yes' ? 'buy every YES' : 'buy every NO', n(p(r).sumAsk).toFixed(3), fmtPct(n(p(r).edge) / Math.max(1e-9, n(p(r).sumAsk)), 2), String(p(r).legs), p(r).maxSizeUsd == null ? '— (run --live)' : fmtUsd(p(r).maxSizeUsd)])} />
            <H sub="P(above X) must be ≥ P(above Y) for X < Y; spread = how far the ladder is inverted">Ladder / threshold violations</H>
            <Table head={['when', 'event', 'lower threshold', 'price', 'higher threshold', 'price', 'spread']}
                rows={ladder.map(r => { const lo = (p(r).lower ?? {}) as P, hi = (p(r).higher ?? {}) as P; return [ago(r.ts), String(p(r).event_slug), <MarketLink key="l" conditionId={lo.condition_id} question={lo.question} />, fmtCents(lo.pYes ?? lo.yes_price), <MarketLink key="h" conditionId={hi.condition_id} question={hi.question} />, fmtCents(hi.pYes ?? hi.yes_price), fmtCents(p(r).spread)]; })} />
            <H sub="narrower event cannot be likelier than the broader one (earlier deadline ≤ later; presidency ≤ nomination)">Logical violations</H>
            <Table head={['when', 'narrower', 'price', 'broader', 'price', 'spread', 'rule']}
                rows={logical.map(r => { const a = (p(r).narrower ?? {}) as P, b = (p(r).broader ?? {}) as P; return [ago(r.ts), <MarketLink key="a" conditionId={a.condition_id} question={a.question} />, fmtCents(a.pYes ?? a.yes_price), <MarketLink key="b" conditionId={b.condition_id} question={b.question} />, fmtCents(b.pYes ?? b.yes_price), fmtCents(p(r).spread), String(p(r).rule ?? p(r).kind ?? '')]; })} />
            <H sub="Polymarket leg + Kalshi leg < $1 after Kalshi fee; confidence = title match quality. Always compare the two rule texts first: same-day BTC markets resolve at different hours on the two venues.">Cross-venue (Kalshi)</H>
            <Table head={['when', 'polymarket market', 'kalshi ticker', 'leg', 'cost', 'edge', 'match conf.']}
                rows={venue.map(r => [ago(r.ts), <MarketLink key="m" conditionId={r.condition_id} question={p(r).question} />, <a key="k" className="text-sky-300 hover:underline" href={`https://kalshi.com/markets/${String(p(r).ticker).split('-')[0].toLowerCase()}`} target="_blank" rel="noreferrer">{String(p(r).ticker)}</a>, LEG[String(p(r).leg)] ?? String(p(r).leg), n(p(r).cost).toFixed(3), fmtPct(p(r).edge, 2), fmtPct(p(r).confidence, 0)])} />
        </div>
    );
}
