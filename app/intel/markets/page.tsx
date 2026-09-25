import { markets, marketCategories } from '@/lib/ui/queries';
import { Table, H, MarketLink, fmtUsd, fmtCents, fmtTs, Pill } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function Markets({ searchParams }: { searchParams: { cat?: string; q?: string; state?: string; order?: string } }) {
    const cat = searchParams.cat || 'all'; const q = searchParams.q || ''; const state = (searchParams.state || 'open') as 'open' | 'resolved' | 'all'; const order = (searchParams.order || 'volume24hr') as 'volume24hr' | 'end_ts' | 'volume';
    const cats = marketCategories();
    const rows = markets({ category: cat, q, resolved: state, order, limit: 300 });
    const link = (o: Record<string, string>) => `/intel/markets?${new URLSearchParams({ cat, q, state, order, ...o }).toString()}`;
    return (
        <div>
            <form className="mb-3 flex flex-wrap items-center gap-2" action="/intel/markets" method="get">
                <input name="q" defaultValue={q} placeholder="search question or slug" className="w-72 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-sm text-white" />
                <input type="hidden" name="cat" value={cat} /><input type="hidden" name="state" value={state} /><input type="hidden" name="order" value={order} />
                <button className="rounded bg-zinc-100 px-2 py-1 font-mono text-[12px] text-zinc-900">search</button>
            </form>
            <div className="flex flex-wrap items-center gap-4">
                <div className="flex flex-wrap gap-1"><a href={link({ cat: 'all' })} className={`rounded px-2 py-1 font-mono text-[12px] ${cat === 'all' ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400'}`}>all</a>{cats.map(c => <a key={c.category} href={link({ cat: c.category })} className={`rounded px-2 py-1 font-mono text-[12px] ${cat === c.category ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}>{c.category} <span className="text-zinc-600">{c.n}</span></a>)}</div>
                <div className="flex flex-wrap gap-1">{['open', 'resolved', 'all'].map(s => <a key={s} href={link({ state: s })} className={`rounded px-2 py-1 font-mono text-[12px] ${state === s ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400'}`}>{s}</a>)}</div>
                <div className="flex flex-wrap gap-1">{[['volume24hr', '24h vol'], ['volume', 'total vol'], ['end_ts', 'ending soon']].map(([v, l]) => <a key={v} href={link({ order: v })} className={`rounded px-2 py-1 font-mono text-[12px] ${order === v ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400'}`}>{l}</a>)}</div>
            </div>
            <H sub={`${rows.length} markets`}>Markets</H>
            <Table head={['market', 'cat', 'yes', 'bid/ask', 'spread', '24h vol', 'total vol', 'liquidity', 'ends', 'state']}
                rows={rows.map(m => [<MarketLink key="m" conditionId={m.condition_id} question={m.question} slug={m.event_slug} />, String(m.category), fmtCents(m.yes_price), `${fmtCents(m.best_bid)}/${fmtCents(m.best_ask)}`, m.spread == null ? '—' : Math.round(Number(m.spread) * 100) + '¢', fmtUsd(m.volume24hr), fmtUsd(m.volume), fmtUsd(m.liquidity), fmtTs(m.end_ts).slice(0, 10), m.resolved ? <Pill key="r" tone="violet">resolved → {String(m.winner_index)}</Pill> : m.neg_risk ? <Pill key="n" tone="amber">neg-risk</Pill> : ''])} />
        </div>
    );
}
