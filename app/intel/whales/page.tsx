import { whalePositionsLatest } from '@/lib/ui/queries';
import { Table, H, WalletLink, MarketLink, fmtUsd, fmtCents, ago, Signed, Empty } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function Whales() {
    const rows = whalePositionsLatest(150);
    return (
        <div>
            <H sub="latest position snapshot per wallet (scripts/pm-ingest.ts + snapshotPositions)">Whale book: open positions</H>
            {rows.length === 0 ? <Empty>No position snapshots yet. The legacy whale feed is at <a className="text-sky-300" href="/dashboard?view=whales">/dashboard?view=whales</a>.</Empty> :
            <Table head={['wallet', 'lb#', 'market', 'side', 'paid', 'now', 'entry', 'cur', 'unrealized', 'seen']}
                rows={rows.map(r => [<WalletLink key="w" address={r.wallet} name={r.username} />, r.lb_rank_pnl_month ?? '—', <MarketLink key="m" conditionId={r.condition_id} question={r.question} slug={r.event_slug} />, String((r.outcomes as string[] | null)?.[Number(r.outcome_index)] ?? r.outcome_index), fmtUsd(r.initial_value), fmtUsd(r.current_value), fmtCents(r.avg_price), fmtCents(r.cur_price), <Signed key="p" n={r.cash_pnl} />, ago(r.ts)])} />}
        </div>
    );
}
