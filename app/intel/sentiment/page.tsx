import { recentSignals } from '@/lib/ui/queries';
import { openDb, all } from '@/lib/pm/db';
import { Table, H, WalletLink, ago, Empty, Sentence } from '@/components/intel/ui';
import { describeSignal } from '@/lib/ui/explain';

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
            <H sub="comment volume several times its normal rate; often precedes news">Comment spikes</H>
            <Table head={['when', 'what happened']} rows={spikes.map(r => [ago(r.ts), <Sentence key="s">{describeSignal(r as never)}</Sentence>])} empty="No spikes in the stored events." />
            <H sub="a commenter argues one side while their wallet holds the other">Says one thing, holds the other</H>
            <Table head={['when', 'commenter', 'what happened']} rows={div.map(r => [ago(r.ts), <WalletLink key="w" address={r.wallet} />, <Sentence key="s">{describeSignal(r as never)}</Sentence>])} empty="None found." />
            <H sub="insider language in comments, weighted by the commenter's record when known">Claims inside information</H>
            <Table head={['when', 'commenter', 'what happened']} rows={leaks.map(r => [ago(r.ts), <WalletLink key="w" address={r.wallet} />, <Sentence key="s">{describeSignal(r as never)}</Sentence>])} empty="None found." />
            <H sub="several accounts posting near-identical text within hours">Coordinated comments</H>
            <Table head={['when', 'what happened']} rows={shills.map(r => [ago(r.ts), <Sentence key="s">{describeSignal(r as never)}</Sentence>])} empty="None found." />
        </div>
    );
}
