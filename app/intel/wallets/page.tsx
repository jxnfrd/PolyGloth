import { topWallets, scoreCategories } from '@/lib/ui/queries';
import { Table, H, WalletLink, fmtUsd, fmtPct, Signed, Empty, fmtDec } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function Wallets({ searchParams }: { searchParams: { cat?: string; win?: string; order?: string; min?: string } }) {
    const cat = searchParams.cat || 'all'; const win = Number(searchParams.win || 0); const order = (searchParams.order === 'worst' ? 'worst' : 'best') as 'best' | 'worst';
    const minResolved = Number(searchParams.min || 30);
    const cats = scoreCategories();
    const rows = topWallets({ category: cat, windowDays: win, minResolved, order, limit: 100 });
    const base = `/intel/wallets`;
    const q = (o: Record<string, string | number>) => `${base}?${new URLSearchParams({ cat, win: String(win), order, min: String(minResolved), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) }).toString()}`;
    return (
        <div>
            <div className="flex flex-wrap items-center gap-4">
                <div className="flex flex-wrap gap-1">{['all', ...cats.filter(c => c !== 'all')].map(c => <a key={c} href={q({ cat: c })} className={`rounded px-2 py-1 font-mono text-[12px] ${cat === c ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}>{c}</a>)}</div>
                <div className="flex flex-wrap gap-1">{[[0, 'all time'], [90, '90d'], [30, '30d']].map(([v, l]) => <a key={v} href={q({ win: v })} className={`rounded px-2 py-1 font-mono text-[12px] ${win === v ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}>{l}</a>)}</div>
                <div className="flex flex-wrap gap-1">{[['best', 'sharpest'], ['worst', 'fade list']].map(([v, l]) => <a key={v} href={q({ order: v })} className={`rounded px-2 py-1 font-mono text-[12px] ${order === v ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}>{l}</a>)}</div>
                <div className="flex flex-wrap gap-1">{[10, 30, 100].map(v => <a key={v} href={q({ min: v })} className={`rounded px-2 py-1 font-mono text-[12px] ${minResolved === v ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}>≥{v} resolved</a>)}</div>
            </div>
            <H sub="calibrated ROI = P/L per unit of odds-adjusted risk; p = one-sided probability the record is luck">{order === 'best' ? 'Sharpest wallets' : 'Anti-leaderboard (fade candidates)'} · {cat} · {win ? `${win}d` : 'all time'}</H>
            {rows.length === 0 ? <Empty>No scores for this filter yet. Run <code>npx tsx scripts/pm-score.ts</code> after the ingest finishes.</Empty> :
            <Table head={['wallet', 'LB rank', 'resolved', 'win %', 'staked', 'P/L', 'ROI', 'calibrated ROI', 'p-value', 'Brier', 'avg entry', 'longshots', 'timing (pp)']}
                rows={rows.map(r => [
                    <WalletLink key="w" address={r.wallet} name={r.username} />, r.lb_rank_pnl_month ?? '—', r.n_resolved, r.n_resolved ? fmtPct(Number(r.wins) / Number(r.n_resolved), 0) : '—',
                    fmtUsd(r.staked), <Signed key="p" n={r.pnl} />, <Signed key="r" n={r.roi} fmt={v => fmtPct(v)} />, <Signed key="c" n={r.calibrated_roi} fmt={v => fmtPct(v)} />,
                    r.p_value == null ? '—' : Number(r.p_value).toFixed(3), r.brier == null ? '—' : Number(r.brier).toFixed(3), r.avg_entry_price == null ? '—' : Math.round(Number(r.avg_entry_price) * 100) + '¢',
                    r.longshot_share == null ? '—' : fmtPct(r.longshot_share, 0), fmtDec(r.entry_timing, 1)
                ])} />}
        </div>
    );
}
