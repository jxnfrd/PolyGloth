import { marketDetail } from '@/lib/ui/queries';
import { Stat, Table, H, Pill, WalletLink, MarketLink, fmtUsd, fmtCents, fmtTs, ago, Empty, fmtPct } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function MarketPage({ params }: { params: { id: string } }) {
    const d = marketDetail(params.id);
    if (!d) return <Empty>Market {params.id} is not in the local store.</Empty>;
    const { market: m, event, siblings, trades, flow, holders, comments, signals, book, prices } = d;
    const outcomes = (m.outcomes as string[] | null) ?? ['Yes', 'No'];
    const buy = (i: number) => Number(flow.find(f => Number(f.outcome_index) === i && f.side === 'BUY')?.usdc ?? 0);
    const sell = (i: number) => Number(flow.find(f => Number(f.outcome_index) === i && f.side === 'SELL')?.usdc ?? 0);
    const imb = (i: number) => { const b = buy(i), s = sell(i); return b + s ? (b - s) / (b + s) : 0; };
    const first = prices[0]?.price, last = prices[prices.length - 1]?.price;
    return (
        <div>
            <div className="mb-1 text-xs text-zinc-500">{String(m.category)} · {String(m.event_slug)} · <a className="text-sky-300 hover:underline" href={`https://polymarket.com/event/${m.event_slug}`} target="_blank" rel="noreferrer">open on polymarket ↗</a></div>
            <h1 className="mb-4 text-lg font-semibold text-white">{String(m.question)}</h1>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Stat label={`${outcomes[0]} price`} value={fmtCents(m.yes_price)} sub={`bid ${fmtCents(m.best_bid)} / ask ${fmtCents(m.best_ask)}`} />
                <Stat label="24h volume" value={fmtUsd(m.volume24hr)} sub={`total ${fmtUsd(m.volume)}`} />
                <Stat label="Liquidity" value={fmtUsd(m.liquidity)} sub={book ? `book ${ago(book.ts)} ago` : 'no book snapshot'} />
                <Stat label="Ends" value={fmtTs(m.end_ts).slice(0, 10)} sub={m.resolved ? `resolved → ${outcomes[Number(m.winner_index)] ?? m.winner_index}` : m.closed ? 'closed' : 'open'} />
                <Stat label={`24h taker flow · ${outcomes[0]}`} value={fmtPct(imb(0), 0)} tone={imb(0) > 0.2 ? 'pos' : imb(0) < -0.2 ? 'neg' : 'muted'} sub={`buy ${fmtUsd(buy(0))} · sell ${fmtUsd(sell(0))}`} />
                <Stat label="Price path (stored)" value={prices.length ? `${fmtCents(first)} → ${fmtCents(last)}` : '—'} sub={prices.length ? `${prices.length} pts` : 'no price history ingested'} />
            </div>
            {book && (
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Depth ≤1¢ (bid / ask)" value={`${fmtUsd(book.depth_bid_1c)} / ${fmtUsd(book.depth_ask_1c)}`} />
                    <Stat label="Depth ≤5¢ (bid / ask)" value={`${fmtUsd(book.depth_bid_5c)} / ${fmtUsd(book.depth_ask_5c)}`} />
                    <Stat label="Spread" value={book.spread == null ? '—' : Math.round(Number(book.spread) * 100) + '¢'} sub={`mid ${fmtCents(book.mid)}`} />
                </div>
            )}
            {siblings.length > 1 && (<><H sub={event?.neg_risk ? 'neg-risk event: outcomes are mutually exclusive' : undefined}>Same event ({siblings.length} markets{event?.neg_risk ? `, YES sum ${fmtPct(siblings.reduce((s, x) => s + Number(x.best_ask ?? x.yes_price ?? 0), 0), 1)}` : ''})</H>
                <Table head={['market', 'yes', 'ask', '24h vol', 'state']} rows={siblings.map(s => [<MarketLink key="m" conditionId={s.condition_id} question={s.question} />, fmtCents(s.yes_price), fmtCents(s.best_ask), fmtUsd(s.volume24hr), s.resolved ? `→ ${String(s.winner_index)}` : ''])} /></>)}
            <H sub="net from ingested trades; scores from wallet_scores when present">Largest holders (ingested wallets)</H>
            <Table head={['wallet', 'side', 'net shares', 'net usd', 'calib ROI', 'resolved', 'p']}
                rows={holders.map(h => [<WalletLink key="w" address={h.wallet} name={h.username} />, String(outcomes[Number(h.outcome_index)] ?? h.outcome_index), Number(h.net_shares).toFixed(0), fmtUsd(h.net_usdc), h.calibrated_roi == null ? '—' : fmtPct(h.calibrated_roi), h.n_resolved ?? '—', h.p_value == null ? '—' : Number(h.p_value).toFixed(3)])} />
            <H>Signals</H>
            <Table head={['when', 'type', 'score', 'wallet', 'detail', 'outcome']} rows={signals.map(s => [ago(s.ts), <Pill key="t" tone="sky">{String(s.type)}</Pill>, s.score == null ? '—' : Number(s.score).toFixed(0), s.wallet ? <WalletLink key="w" address={s.wallet} /> : '—', <span key="d" className="text-zinc-400">{JSON.stringify(s.payload).slice(0, 100)}</span>, s.outcome ? <Pill key="o" tone={s.outcome === 'WIN' ? 'emerald' : 'rose'}>{String(s.outcome)}</Pill> : '—'])} />
            {comments.length > 0 && (<><H sub={`event ${event?.id}`}>Comments (stored)</H>
                <div className="space-y-2">{comments.map(c => <div key={String(c.id)} className="rounded border border-zinc-800 px-3 py-2 text-sm"><div className="mb-1 text-xs text-zinc-500">{ago(c.created_ts)} ago · <WalletLink address={c.proxy_wallet} name={c.name} /> · {String(c.reaction_count)} reactions</div><div className="text-zinc-200">{String(c.body)}</div></div>)}</div></>)}
            <H sub="newest 300 from ingested wallets">Trade tape</H>
            <Table head={['when', 'wallet', 'side', 'outcome', 'price', 'shares', 'usd']} rows={trades.map(t => [ago(t.ts), <WalletLink key="w" address={t.wallet} name={t.username} />, <Pill key="s" tone={t.side === 'BUY' ? 'emerald' : 'rose'}>{String(t.side)}</Pill>, String(t.outcome), fmtCents(t.price), Number(t.size).toFixed(0), fmtUsd(t.usdc)])} />
            <H>Resolution rules</H>
            <pre className="whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-400">{String(m.description || '(no description)')}</pre>
            {m.resolution_source ? <div className="mt-2 text-xs text-zinc-500">source: {String(m.resolution_source)}</div> : null}
        </div>
    );
}
