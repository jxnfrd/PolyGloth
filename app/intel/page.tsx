import { stats, freshness, signalCounts, recentSignals, topWallets } from '@/lib/ui/queries';
import { openDb, all, kvGet } from '@/lib/pm/db';
import { Stat, Table, H, ago, fmtTs, fmtPct, fmtUsd, MarketLink, WalletLink, SignalType, Sentence, Term } from '@/components/intel/ui';
import { describeSignal, SIGNAL_LABEL } from '@/lib/ui/explain';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Row = Record<string, unknown>;

export default function IntelOverview() {
    openDb();
    const s = stats(); const f = freshness(); const counts = signalCounts(); const recent = recentSignals(undefined, 30);
    const sharp = topWallets({ category: 'all', windowDays: 0, minResolved: 30, limit: 5 }).filter(w => Number(w.p_value) < 0.1 && Number(w.calibrated_roi) > 0);
    const wf = kvGet<{ outOfSample: Record<string, { equalWeightRoi: number | null; positions: number }>; inSample: { sharp: number } }>('backtest:walkforward:7d');
    const consensus = recentSignals('consensus', 3), arbs = all<Row>(`SELECT s.*, m.question, m.event_slug FROM signals s LEFT JOIN markets m ON m.condition_id = s.condition_id WHERE s.type LIKE 'arb_%' ORDER BY s.score DESC LIMIT 3`).map(r => ({ ...r, payload: JSON.parse(String(r.payload)) }));
    const early = recentSignals('early_resolution', 2), spikes = recentSignals('comment_spike', 2);
    const insiders = recentSignals('insider', 3);
    const findings: { text: string; href: string }[] = [];
    if (wf) { const sh = wf.outOfSample.sharp, ctl = wf.outOfSample.other_eligible; findings.push({ text: `Backtest: the ${wf.inSample.sharp} wallets ranked "sharp" a week ago earned ${fmtPct(sh?.equalWeightRoi)} per position since, against ${fmtPct(ctl?.equalWeightRoi)} for ordinary wallets. The ranking has not proven predictive yet, so treat wallet tables as description, not advice.`, href: '/intel/backtest' }); }
    if (sharp.length) findings.push({ text: `${sharp.length} wallets currently beat the odds with a record unlikely to be luck: ${sharp.map(w => String(w.username || String(w.wallet).slice(0, 8))).join(', ')}.`, href: '/intel/wallets' });
    for (const c of consensus) findings.push({ text: describeSignal(c as never), href: `/intel/markets/${c.condition_id}` });
    for (const a of arbs) findings.push({ text: describeSignal(a as never), href: '/intel/arb' });
    for (const e of early) findings.push({ text: describeSignal(e as never), href: '/intel/resolution' });
    for (const sp of spikes) findings.push({ text: describeSignal(sp as never), href: '/intel/sentiment' });
    for (const i of insiders.slice(0, 2)) findings.push({ text: describeSignal(i as never), href: `/intel/markets/${i.condition_id}` });
    const graded = counts.filter(c => c.wins + c.losses > 0);

    return (
        <div>
            <H sub={`data as of ${fmtTs(f.lastIngestTs)}`}>What the data says today</H>
            {findings.length === 0 ? <div className="text-sm text-zinc-500">Nothing recorded yet. Run the ingest and the analytics chain (see HANDOVER.md).</div> :
            <ol className="space-y-2">
                {findings.map((x, i) => <li key={i} className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm leading-6 text-zinc-200"><span className="font-mono text-zinc-500">{i + 1}.</span><span className="flex-1">{x.text} <Link href={x.href} className="text-sky-300 hover:underline">open →</Link></span></li>)}
            </ol>}

            <H>How much history the system has</H>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label="Wallets with trade history" value={s.wallets_with_trades} sub={`${s.wallets.toLocaleString()} wallets seen in total`} />
                <Stat label="Trades stored" value={s.trades.toLocaleString()} sub={`newest ${ago(f.lastTradeTs)} ago`} />
                <Stat label="Markets" value={s.markets.toLocaleString()} sub={`${s.resolved_markets.toLocaleString()} already settled`} />
                <Stat label="Signals recorded" value={s.signals.toLocaleString()} sub={`newest ${ago(f.lastSignalTs)} ago`} />
                <Stat label="Kalshi markets" value={s.kalshi_markets.toLocaleString()} sub={`${s.comments.toLocaleString()} comments stored`} />
            </div>
            <p className="mt-2 text-xs text-zinc-500">Rule of thumb: conclusions about a wallet need 30+ settled positions; conclusions about a signal type need 30+ graded signals. Numbers above that bar are still small for a market this size.</p>

            <H sub="hit rate appears once markets resolve and the signal is graded">Which kinds of signal have been right</H>
            <Table head={['signal type', 'recorded', 'graded', <Term key="h" k="signal">hit rate</Term>, 'newest']}
                rows={counts.map(c => { const res = c.wins + c.losses; return [<SignalType key="t" type={c.type} />, c.n, res, res ? `${Math.round(100 * c.wins / res)}%` : 'not graded yet', ago(c.last_ts)]; })}
                empty="No signals yet." />
            {graded.length === 0 && <p className="mt-2 text-xs text-zinc-500">Nothing is graded yet because every signal was recorded today and its market has not settled. Grades arrive with each resolution pass.</p>}

            <H>Newest signals, in plain words</H>
            <Table head={['when', 'type', 'what happened', 'market']}
                rows={recent.map(r => [ago(r.ts), <SignalType key="t" type={r.type} />, <Sentence key="s">{describeSignal(r as never)}</Sentence>, r.condition_id ? <MarketLink key="m" conditionId={r.condition_id} question="open" /> : (r.wallet ? <WalletLink key="w" address={r.wallet} /> : '—')])} />
            <p className="mt-2 text-xs text-zinc-500">Labels: {Object.entries(SIGNAL_LABEL).slice(0, 6).map(([k, v]) => `${v} (${k})`).join(' · ')} … full glossary on hover over any underlined term.</p>
        </div>
    );
}
