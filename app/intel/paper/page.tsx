import { paperReport } from '@/lib/ui/queries';
import { Table, H, Pill, MarketLink, WalletLink, fmtUsd, fmtCents, ago, Signed } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function Paper() {
    const { byStrategy, recent } = paperReport();
    return (
        <div>
            <H sub="paper only: no key, no live orders">Paper strategies</H>
            <Table head={['strategy', 'orders', 'open', 'rejected', 'done', 'wins', 'notional', 'P/L']}
                rows={byStrategy.map(s => [String(s.strategy), s.n, s.open, s.rejected, s.done, s.wins, fmtUsd(s.usd), <Signed key="p" n={s.pnl} />])}
                empty="No paper orders yet. Run: npx tsx scripts/pm-paper.ts or scripts/pm-backtest.ts" />
            <H>Recent paper orders</H>
            <Table head={['when', 'strategy', 'leader', 'market', 'side', 'price', 'usd', 'status', 'P/L', 'reason']}
                rows={recent.map(o => [ago(o.ts), String(o.strategy), o.wallet ? <WalletLink key="w" address={o.wallet} /> : '—', <MarketLink key="m" conditionId={o.condition_id} question={o.question} />, <Pill key="s" tone={o.side === 'BUY' ? 'emerald' : 'rose'}>{String(o.side)} {String(o.outcome_index)}</Pill>, fmtCents(o.price), fmtUsd(o.usd), <Pill key="st" tone={o.status === 'rejected' ? 'rose' : o.status === 'open' ? 'amber' : 'zinc'}>{String(o.status)}</Pill>, o.pnl == null ? '—' : <Signed key="p" n={o.pnl} />, <span key="r" className="text-zinc-400">{String(o.reason ?? '')}</span>])} />
        </div>
    );
}
