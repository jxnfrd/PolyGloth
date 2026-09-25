import { walletOverview } from '@/lib/ui/queries';
import { Stat, Table, H, Pill, MarketLink, fmtUsd, fmtPct, fmtTs, ago, Signed, Empty, short, fmtDec, Term, SignalType, Sentence } from '@/components/intel/ui';
import { describeSignal } from '@/lib/ui/explain';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function WalletPage({ params }: { params: { address: string } }) {
    const { wallet, scores, trades, byCategory, signals } = walletOverview(params.address);
    const a = params.address.toLowerCase();
    const allTime = scores.find(s => s.category === 'all' && Number(s.window_days) === 0);
    return (
        <div>
            <div className="mb-4 flex flex-wrap items-baseline gap-3">
                <h1 className="font-mono text-lg text-white">{wallet?.username ? String(wallet.username) : short(a, 8)}</h1>
                <span className="font-mono text-xs text-zinc-500">{a}</span>
                <a className="text-xs text-sky-300 hover:underline" href={`https://polymarket.com/profile/${a}`} target="_blank" rel="noreferrer">polymarket ↗</a>
                <a className="text-xs text-sky-300 hover:underline" href={`https://polygonscan.com/address/${a}`} target="_blank" rel="noreferrer">polygonscan ↗</a>
            </div>
            {!wallet && <Empty>Wallet not ingested. Run <code>npx tsx scripts/pm-ingest.ts wallet {a}</code></Empty>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Stat label="Leaderboard (30d P/L)" value={wallet?.lb_rank_pnl_month ? `#${wallet.lb_rank_pnl_month}` : '—'} sub={wallet?.lb_pnl_month != null ? fmtUsd(wallet.lb_pnl_month) : undefined} />
                <Stat label="Trades ingested" value={wallet?.trade_count ?? 0} sub={wallet?.first_trade_ts ? `since ${fmtTs(wallet.first_trade_ts).slice(0, 10)}` : undefined} />
                <Stat label="Resolved positions" value={allTime?.n_resolved ?? '—'} sub={allTime ? `${allTime.wins} wins` : 'not scored'} />
                <Stat label="ROI" value={allTime ? fmtPct(allTime.roi) : '—'} tone={allTime && Number(allTime.roi) > 0 ? 'pos' : allTime ? 'neg' : 'muted'} sub={allTime ? `P/L ${fmtUsd(allTime.pnl)} on ${fmtUsd(allTime.staked)}` : undefined} />
                <Stat label={<Term k="calibrated ROI">Calibrated ROI</Term> as unknown as string} value={allTime ? fmtPct(allTime.calibrated_roi) : '—'} tone={allTime && Number(allTime.calibrated_roi) > 0 ? 'pos' : allTime ? 'neg' : 'muted'} sub={allTime?.p_value != null ? `p = ${Number(allTime.p_value).toFixed(3)}` : undefined} />
                <Stat label="Avg entry" value={allTime?.avg_entry_price != null ? Math.round(Number(allTime.avg_entry_price) * 100) + '¢' : '—'} sub={allTime?.longshot_share != null ? `${fmtPct(allTime.longshot_share, 0)} longshots` : undefined} />
            </div>
            <H>Track record by category and window</H>
            <Table head={[<Term key="z" k="category" />, 'window', <Term key="b" k="resolved" />, <Term key="c" k="win %" />, <Term key="d" k="staked" />, 'P/L', <Term key="e" k="ROI" />, <Term key="f" k="calibrated ROI" />, <Term key="g" k="p-value" />, <Term key="h" k="Brier" />, <Term key="k" k="timing (pp)" />]}
                rows={scores.map(s => [s.category, Number(s.window_days) ? `${s.window_days}d` : 'all', s.n_resolved, s.n_resolved ? fmtPct(Number(s.wins) / Number(s.n_resolved), 0) : '—', fmtUsd(s.staked), <Signed key="p" n={s.pnl} />, <Signed key="r" n={s.roi} fmt={v => fmtPct(v)} />, <Signed key="c" n={s.calibrated_roi} fmt={v => fmtPct(v)} />, s.p_value == null ? '—' : Number(s.p_value).toFixed(3), s.brier == null ? '—' : Number(s.brier).toFixed(3), fmtDec(s.entry_timing, 1)])}
                empty="Not scored yet (npx tsx scripts/pm-score.ts)." />
            <H>Where the money goes</H>
            <Table head={['category', 'trades', 'notional']} rows={byCategory.map(c => [c.category, c.n, fmtUsd(c.usdc)])} />
            <H>Signals about this wallet</H>
            <Table head={['when', 'type', 'what happened', 'outcome']} rows={signals.map(s => [ago(s.ts), <SignalType key="t" type={s.type} />, <Sentence key="s">{describeSignal(s as never)} {s.condition_id ? <MarketLink conditionId={s.condition_id} question="open market" /> : null}</Sentence>, s.outcome ? <Pill key="o" tone={s.outcome === 'WIN' ? 'emerald' : 'rose'}>{String(s.outcome)}</Pill> : 'pending'])} />
            <H sub="newest 200">Trade tape</H>
            <Table head={['when', 'side', 'outcome', 'price', 'shares', 'usd', 'market', 'cat', 'result']}
                rows={trades.map(t => [ago(t.ts), <Pill key="s" tone={t.side === 'BUY' ? 'emerald' : 'rose'}>{String(t.side)}</Pill>, String(t.outcome), Math.round(Number(t.price) * 100) + '¢', Number(t.size).toFixed(0), fmtUsd(t.usdc), <MarketLink key="m" conditionId={t.condition_id} question={t.question || t.title} slug={t.event_slug} />, String(t.category ?? ''), t.resolved ? (Number(t.winner_index) === Number(t.outcome_index) ? <Pill key="w" tone="emerald">WIN</Pill> : <Pill key="l" tone="rose">LOSS</Pill>) : '—'])} />
        </div>
    );
}
