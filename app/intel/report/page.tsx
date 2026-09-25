import { reportPage } from '@/lib/ui/queries-report';
import { Stat, Table, H, Pill, MarketLink, WalletLink, fmtUsd, fmtPct, fmtTs, Signed } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function Report() {
    const r = reportPage();
    const d = (ts: number | null) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '—');
    return (
        <div>
            <div className="mb-3 text-xs text-zinc-500">Window {d(r.from)} → {d(r.to)} vs prior {d(r.prevFrom)} → {d(r.from)} · generated {fmtTs(r.generatedTs)} · refresh with <code>npx tsx scripts/pm-report.ts</code> (also writes reports/edge-YYYY-MM-DD.md)</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label="Signals this week" value={r.signals.reduce((s, x) => s + x.n, 0)} sub={`${r.signals.reduce((s, x) => s + x.nPrev, 0)} prior week`} />
                <Stat label="Decayed signal types" value={r.decayed.length} tone={r.decayed.length ? 'neg' : 'muted'} sub="hit rate fell ≥15 pp" />
                <Stat label="Arb signals" value={r.arb.n} sub={r.arb.bestEdge === null ? 'no arbs' : `best ${(r.arb.bestEdge * 100).toFixed(2)}% ${r.arb.bestType}`} />
                <Stat label="Insider ledger" value={fmtPct(r.insider.hitRate, 0)} sub={`${r.insider.resolved}/${r.insider.flags} resolved`} tone="muted" />
                <Stat label="Resolved markets in store" value={r.dataFreshness.resolvedMarkets.toLocaleString()} sub={`scores ${d(r.dataFreshness.lastScoreTs)}`} />
            </div>
            <H>Signals: this week vs prior</H>
            <Table head={['type', 'n', 'prior n', 'resolved', 'hit rate', 'prior hit', 'decayed']} rows={r.signals.map(s => [s.type, s.n, s.nPrev, s.resolved, fmtPct(s.hitRate, 0), fmtPct(s.hitRatePrev, 0), s.decayed ? <Pill key="d" tone="rose">decayed</Pill> : ''])} empty="No signals in either window." />
            <H sub="30d vs 90d calibrated ROI changed sign">Wallets whose edge flipped</H>
            <Table head={['wallet', '90d calib ROI', '30d calib ROI', 'direction']} rows={r.walletsFlipped.map(w => [<WalletLink key="w" address={w.wallet} name={w.username} />, fmtPct(w.roi90, 1), fmtPct(w.roi30, 1), <Pill key="p" tone={w.direction === 'improving' ? 'emerald' : 'rose'}>{w.direction}</Pill>])} empty="No flips (needs scored wallets with ≥10 resolved in 30d and ≥20 in 90d)." />
            <H>Consensus markets</H>
            <Table head={['market', 'side', 'wallets', 'usdc', 'score']} rows={r.consensusTop.map(c => [<MarketLink key="m" conditionId={c.condition_id} question={c.question} />, c.outcome_index, c.wallets, fmtUsd(c.usdc), c.score == null ? '—' : Math.round(c.score)])} empty="No consensus signals this week." />
            <H>Paper P/L by strategy</H>
            <Table head={['strategy', 'orders', 'resolved', 'wins', 'staked', 'P/L']} rows={r.paper.map(p => [p.strategy, p.n, p.resolved, p.wins, fmtUsd(p.staked), <Signed key="p" n={p.pnl} />])} empty="No paper orders this week." />
            <H>Comment spikes</H>
            <Table head={['market', 'z', 'when']} rows={r.commentSpikes.map(c => [<MarketLink key="m" conditionId={c.condition_id} question={c.question} />, c.z.toFixed(1), fmtTs(c.ts)])} empty="No comment spikes this week." />
        </div>
    );
}
