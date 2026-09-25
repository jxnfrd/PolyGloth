import { kalshiMarkets } from '@/lib/ui/queries';
import { Table, H, fmtUsd, fmtCents, fmtTs, fmtNum } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function Kalshi({ searchParams }: { searchParams: { q?: string } }) {
    const q = searchParams.q || '';
    const rows = kalshiMarkets(q, 300);
    return (
        <div>
            <form className="mb-3 flex gap-2" action="/intel/kalshi" method="get"><input name="q" defaultValue={q} placeholder="search title" className="w-72 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-sm text-white" /><button className="rounded bg-zinc-100 px-2 py-1 font-mono text-[12px] text-zinc-900">search</button></form>
            <H sub={`${rows.length} open markets (public API, anonymous flow only)`}>Kalshi markets</H>
            <Table head={['ticker', 'title', 'yes bid/ask', 'no bid/ask', 'last', '24h vol', 'OI', 'closes']}
                rows={rows.map(m => [<a key="t" className="text-sky-300 hover:underline" href={`https://kalshi.com/markets/${String(m.series_ticker || '').toLowerCase()}`} target="_blank" rel="noreferrer">{String(m.ticker)}</a>, <span key="x" title={String(m.subtitle)}>{String(m.title).slice(0, 70)}</span>, `${fmtCents(m.yes_bid)}/${fmtCents(m.yes_ask)}`, `${fmtCents(m.no_bid)}/${fmtCents(m.no_ask)}`, fmtCents(m.last_price), fmtNum(m.volume24h), fmtNum(m.open_interest), fmtTs(m.close_ts).slice(0, 10)])} />
        </div>
    );
}
