import { recentSignals } from '@/lib/ui/queries';
import { openDb, all } from '@/lib/pm/db';
import { Table, H, WalletLink, MarketLink, ago, Empty, Pill, fmtPct } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type P = Record<string, unknown>;
const p = (r: Record<string, unknown>) => (r.payload ?? {}) as P;

function commentActivity() {
    openDb();
    const t = Math.floor(Date.now() / 1000);
    return all<Record<string, unknown>>(
        `SELECT e.id, e.slug, e.title, e.category, e.comment_count,
                SUM(CASE WHEN c.created_ts > ? THEN 1 ELSE 0 END) last24h,
                SUM(CASE WHEN c.created_ts > ? THEN 1 ELSE 0 END) last7d,
                COUNT(DISTINCT c.proxy_wallet) commenters, MAX(c.created_ts) last_ts
           FROM events e JOIN comments c ON c.event_id = e.id GROUP BY e.id ORDER BY last24h DESC, last7d DESC LIMIT 30`, t - 86400, t - 7 * 86400);
}

export default function Sentiment() {
    const spikes = recentSignals('comment_spike', 30), div = recentSignals('talk_wallet_divergence', 60), leaks = recentSignals('leak_phrase', 60), shills = recentSignals('shill_cluster', 30);
    const activity = commentActivity();
    return (
        <div>
            <H sub="events with stored comments; run npx tsx scripts/pm-sentiment.ts top to refresh">Comment activity</H>
            {activity.length === 0 ? <Empty>No comments stored yet.</Empty> :
            <Table head={['event', 'cat', 'total', 'stored 24h', 'stored 7d', 'commenters', 'last']}
                rows={activity.map(a => [<a key="e" className="text-sky-300 hover:underline" href={`https://polymarket.com/event/${a.slug}`} target="_blank" rel="noreferrer">{String(a.title).slice(0, 70)}</a>, String(a.category), a.comment_count, a.last24h, a.last7d, a.commenters, ago(a.last_ts)])} />}
            <H sub="comments per hour vs trailing 7-day mean, z ≥ 3">Comment velocity spikes</H>
            <Table head={['when', 'event', 'last hour', 'mean/hour', 'z']} rows={spikes.map(r => [ago(r.ts), String(p(r).slug), String(p(r).lastHour), Number(p(r).meanHourly).toFixed(2), Number(p(r).z).toFixed(1)])} />
            <H sub="commenter argues one side while their wallet holds the other (pump-to-exit pattern)">Talk vs wallet divergence</H>
            <Table head={['when', 'wallet', 'event', 'says', 'holds', 'conf.', 'comment']}
                rows={div.map(r => [ago(r.ts), <WalletLink key="w" address={r.wallet} />, String(p(r).slug), <Pill key="s" tone={p(r).stance === 'YES' ? 'emerald' : 'rose'}>{String(p(r).stance)}</Pill>, <Pill key="h" tone={p(r).held === 'YES' ? 'emerald' : 'rose'}>{String(p(r).held)}</Pill>, r.score, <span key="b" className="whitespace-normal text-zinc-400">{String(p(r).body).slice(0, 140)}</span>])} />
            <H sub="'hearing that', 'source says', 'just confirmed'… weighted by the commenter's track record when known">Leak phrases</H>
            <Table head={['when', 'wallet', 'event', 'phrases', 'wallet calib ROI', 'comment']}
                rows={leaks.map(r => { const ws = (p(r).walletScore ?? null) as P | null; return [ago(r.ts), <WalletLink key="w" address={r.wallet} />, String(p(r).slug), (p(r).phrases as string[] | undefined)?.join(', ') ?? '', ws?.calibrated_roi != null ? fmtPct(ws.calibrated_roi) : 'unscored', <span key="b" className="whitespace-normal text-zinc-400">{String(p(r).body).slice(0, 140)}</span>]; })} />
            <H sub="≥3 accounts posting near-identical text within 6 h">Shill clusters</H>
            <Table head={['when', 'event', 'accounts', 'posts', 'sample']} rows={shills.map(r => [ago(r.ts), String(p(r).slug), (p(r).wallets as string[] | undefined)?.length ?? '', String(p(r).n), <span key="s" className="whitespace-normal text-zinc-400">{String(p(r).sample).slice(0, 160)}</span>])} />
        </div>
    );
}
