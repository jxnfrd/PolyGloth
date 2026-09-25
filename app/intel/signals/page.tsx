import { recentSignals, signalCounts } from '@/lib/ui/queries';
import { Table, H, Pill, MarketLink, WalletLink, ago, SignalType, Sentence } from '@/components/intel/ui';
import { describeSignal, SIGNAL_LABEL } from '@/lib/ui/explain';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function Signals({ searchParams }: { searchParams: { type?: string } }) {
    const type = searchParams.type || '';
    const counts = signalCounts(); const rows = recentSignals(type || undefined, 300);
    return (
        <div>
            <div className="flex flex-wrap gap-1">
                <a href="/intel/signals" className={`rounded px-2 py-1 font-mono text-[12px] ${!type ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400'}`}>all</a>
                {counts.map(c => <a key={c.type} href={`/intel/signals?type=${c.type}`} className={`rounded px-2 py-1 text-[12px] ${type === c.type ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}>{SIGNAL_LABEL[c.type] ?? c.type} <span className="text-zinc-600">{c.n}</span></a>)}
            </div>
            <H sub="outcome is graded when the market resolves">{type ? (SIGNAL_LABEL[type] ?? type) : 'All signals'}</H>
            <Table head={['when', 'type', 'what happened', 'score', 'category', 'price now', 'wallet', 'outcome']}
                rows={rows.map(r => [ago(r.ts), <SignalType key="t" type={r.type} />, <Sentence key="s">{describeSignal(r as never)} {r.condition_id ? <MarketLink conditionId={r.condition_id} question="open market" /> : null}</Sentence>, r.score == null ? '—' : Number(r.score).toFixed(0), String(r.category ?? ''), r.yes_price == null ? '—' : Math.round(Number(r.yes_price) * 100) + '¢', r.wallet ? <WalletLink key="w" address={r.wallet} /> : '—', r.outcome ? <Pill key="o" tone={r.outcome === 'WIN' ? 'emerald' : 'rose'}>{String(r.outcome)}</Pill> : 'pending'])} />
        </div>
    );
}
