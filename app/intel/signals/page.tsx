import { recentSignals, signalCounts } from '@/lib/ui/queries';
import { Table, H, Pill, MarketLink, WalletLink, ago } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function Signals({ searchParams }: { searchParams: { type?: string } }) {
    const type = searchParams.type || '';
    const counts = signalCounts(); const rows = recentSignals(type || undefined, 300);
    return (
        <div>
            <div className="flex flex-wrap gap-1">
                <a href="/intel/signals" className={`rounded px-2 py-1 font-mono text-[12px] ${!type ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400'}`}>all</a>
                {counts.map(c => <a key={c.type} href={`/intel/signals?type=${c.type}`} className={`rounded px-2 py-1 font-mono text-[12px] ${type === c.type ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}>{c.type} <span className="text-zinc-600">{c.n}</span></a>)}
            </div>
            <H sub="outcome is filled when the market resolves (scripts/pm-ingest.ts resolutions)">Signal feed {type && `· ${type}`}</H>
            <Table head={['when', 'type', 'score', 'market', 'cat', 'price', 'wallet', 'payload', 'outcome']}
                rows={rows.map(r => [ago(r.ts), <Pill key="t" tone="sky">{String(r.type)}</Pill>, r.score == null ? '—' : Number(r.score).toFixed(0), <MarketLink key="m" conditionId={r.condition_id} question={r.question} slug={r.event_slug} />, String(r.category ?? ''), r.yes_price == null ? '—' : Math.round(Number(r.yes_price) * 100) + '¢', r.wallet ? <WalletLink key="w" address={r.wallet} /> : '—', <span key="p" className="text-zinc-400" title={JSON.stringify(r.payload)}>{JSON.stringify(r.payload).slice(0, 110)}</span>, r.outcome ? <Pill key="o" tone={r.outcome === 'WIN' ? 'emerald' : 'rose'}>{String(r.outcome)}</Pill> : '—'])} />
        </div>
    );
}
