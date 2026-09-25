import { stats, freshness, signalCounts, recentSignals } from '@/lib/ui/queries';
import { Stat, Table, H, ago, fmtTs, Pill, MarketLink, WalletLink } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function IntelOverview() {
    const s = stats(); const f = freshness(); const counts = signalCounts(); const recent = recentSignals(undefined, 40);
    return (
        <div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label="Wallets with history" value={s.wallets_with_trades} sub={`${s.wallets} known`} />
                <Stat label="Trades" value={s.trades.toLocaleString()} sub={`last ${ago(f.lastTradeTs)} ago`} />
                <Stat label="Markets" value={s.markets.toLocaleString()} sub={`${s.resolved_markets.toLocaleString()} resolved`} />
                <Stat label="Signals" value={s.signals.toLocaleString()} sub={`last ${ago(f.lastSignalTs)} ago`} />
                <Stat label="Kalshi markets" value={s.kalshi_markets.toLocaleString()} sub={`${s.comments.toLocaleString()} comments`} />
            </div>
            <H sub={`ingest ${fmtTs(f.lastIngestTs)} · scores ${fmtTs(f.lastScoreTs)}`}>Signal ledger</H>
            <Table head={['type', 'count', 'resolved', 'hit rate', 'last']}
                rows={counts.map(c => { const res = c.wins + c.losses; return [c.type, c.n, res, res ? `${Math.round(100 * c.wins / res)}%` : '—', ago(c.last_ts)]; })}
                empty="No signals yet. Run: npx tsx scripts/pm-score.ts, pm-fade.ts, pm-insider.ts, pm-arb.ts, pm-flow.ts, pm-sentiment.ts" />
            <H>Latest signals</H>
            <Table head={['when', 'type', 'score', 'market', 'wallet', 'detail']}
                rows={recent.map(r => [ago(r.ts), <Pill key="t" tone="sky">{String(r.type)}</Pill>, r.score == null ? '—' : Number(r.score).toFixed(0), <MarketLink key="m" conditionId={r.condition_id} question={r.question} slug={r.event_slug} />, r.wallet ? <WalletLink key="w" address={r.wallet} /> : '—', <span key="d" className="text-zinc-400">{summarize(r.payload)}</span>])} />
        </div>
    );
}

function summarize(p: unknown): string {
    if (!p || typeof p !== 'object') return '';
    const o = p as Record<string, unknown>;
    const keys = ['reasons', 'reason', 'side', 'edge', 'edgePct', 'stance', 'usdc', 'score', 'note', 'question'];
    const fmt = (v: unknown): string => Array.isArray(v) ? v.map(fmt).join('|') : typeof v === 'number' ? (Math.abs(v) < 1 && v !== 0 ? (v * 100).toFixed(1) + '%' : Number(v.toFixed(2)).toString()) : String(v).slice(0, 40);
    return keys.filter(k => o[k] !== undefined).map(k => `${k}=${fmt(o[k])}`).join(' · ').slice(0, 120);
}
