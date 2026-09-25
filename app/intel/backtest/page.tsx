import { openDb, kvGet, all } from '@/lib/pm/db';
import { Stat, Table, H, Pill, WalletLink, MarketLink, fmtUsd, fmtPct, fmtTs, Empty, Term } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Grp = { positions: number; winRate: number | null; staked: number; pnl: number; roi: number | null; calibratedRoi: number | null; equalWeightRoi: number | null };
type WF = { cutoff: string; daysAgo: number; minResolved: number; slippageBps: number; resolvedMarkets: number; inSample: { walletsScored: number; eligible: number; sharp: number; fade: number; sharpList: { w: string; n: number; cal: number; roi: number; p: number }[] }; outOfSample: Record<string, Grp>; sharpByCategory: Record<string, Grp>; sharpPerWallet: ({ wallet: string; username: string } & Grp)[]; generatedAt: string };
type Strat = { strategy: string; params: Record<string, number>; markets: number; bars: number; n: number; wins: number; winRate: number; staked: number; pnl: number; roi: number; maxDrawdown: number; byCategory: Record<string, { n: number; pnl: number; staked: number }>; trades: { question: string; conditionId?: string; condition_id?: string; outcomeIndex: number; entryPrice: number; usd: number; exitReason: string; pnl: number; reason: string }[]; days: number; excludeSports: boolean; generatedAt: string };

const GROUPS: [string, string, string][] = [
    ['sharp', 'Sharp wallets', 'ranked best before the cutoff'],
    ['other_eligible', 'Control', 'every other wallet with enough history'],
    ['fade', 'Fade candidates', 'ranked worst before the cutoff'],
    ['all_wallets', 'Everyone', 'all wallets with history']
];
const STRAT_LABEL: Record<string, [string, string]> = {
    near_certainty: ['Last-cents harvester', 'Buy the 97–99¢ side of markets ending within a week and hold to $1.'],
    deadline_decay: ['Deadline decay', 'For "by <date>" markets, bet NO when most of the time has passed and nothing has happened, if the price still says YES is likely.'],
    thin_move: ['Thin-move fade', 'When price jumps 8¢+ in an hour on almost no volume, bet on half of it snapping back.']
};

function Bar({ value, max }: { value: number | null; max: number }) {
    if (value == null) return <div className="text-xs text-zinc-500">no data</div>;
    const w = Math.min(100, Math.abs(value) / max * 100);
    return (
        <div className="flex items-center gap-2">
            <div className="relative h-3 w-40 rounded bg-zinc-800"><div className={`absolute top-0 h-3 rounded ${value >= 0 ? 'left-1/2 bg-emerald-500/70' : 'right-1/2 bg-rose-500/70'}`} style={{ width: `${w / 2}%` }} /><div className="absolute left-1/2 top-0 h-3 w-px bg-zinc-600" /></div>
            <span className={`font-mono text-sm ${value >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{value >= 0 ? '+' : ''}{fmtPct(value)}</span>
        </div>
    );
}

export default function Backtest() {
    openDb();
    const wf7 = kvGet<WF>('backtest:walkforward:7d'), wf14 = kvGet<WF>('backtest:walkforward:14d');
    const strategies = all<{ key: string; value: string }>("SELECT key, value FROM kv WHERE key LIKE 'backtest:strategy:%'").map(r => JSON.parse(r.value) as Strat);
    const verdict = (wf: WF) => { const sh = wf.outOfSample.sharp?.equalWeightRoi ?? 0, ctl = wf.outOfSample.other_eligible?.equalWeightRoi ?? 0; return sh > ctl + 0.02 ? 'The ranking beat the control group. Encouraging, but check the sample size before acting.' : sh > 0.02 ? 'The ranking made money but did not beat ordinary wallets. No evidence of skill selection.' : 'The ranking did not predict returns. Do not copy wallets on this evidence.'; };
    return (
        <div>
            <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-sm leading-6 text-zinc-200">
                <p><b>The question.</b> This product ranks wallets by how well they beat the odds. A ranking is only useful if the wallets at the top keep winning <i>after</i> you rank them. This page checks exactly that, with no cheating: wallets are ranked using only trades and results known before a cutoff date, then we measure what their trades placed <i>after</i> the cutoff earned, as if you had copied each one at its own price plus 0.5% slippage and held to resolution.</p>
                <p className="mt-2"><b>How to read the bars.</b> Each bar is the return per position if you had put the same $1 on every trade in that group (<Term k="equal-weight ROI">equal-weight</Term>). Green right = profit, red left = loss. "Sharp" must clearly beat "Control" for the ranking to mean anything.</p>
            </div>

            {!wf7 && <Empty>No walk-forward result stored yet. Run <code>npx tsx scripts/backtest-walkforward.ts 7</code>.</Empty>}
            {[wf7, wf14].filter(Boolean).map(wf => wf && (
                <div key={wf.daysAgo} className="mb-10 rounded-lg border border-zinc-800 p-4">
                    <div className="mb-1 text-base font-semibold text-white">Ranked {wf.daysAgo} days ago, measured since</div>
                    <div className="mb-4 text-sm text-zinc-400">Cutoff {fmtTs(Date.parse(wf.cutoff) / 1000).slice(0, 10)}. {wf.inSample.walletsScored} wallets had enough history to rank; {wf.inSample.sharp} qualified as <Term k="sharp">sharp</Term>, {wf.inSample.fade} as <Term k="fade">fade candidates</Term>. {wf.resolvedMarkets.toLocaleString()} settled markets were used to grade results.</div>
                    <div className="grid gap-3 md:grid-cols-2">
                        {GROUPS.map(([k, label, sub]) => { const g = wf.outOfSample[k]; return (
                            <div key={k} className="rounded border border-zinc-800/80 bg-zinc-950/40 px-4 py-3">
                                <div className="flex items-baseline justify-between"><span className="font-medium text-white">{label}</span><span className="text-xs text-zinc-500">{sub}</span></div>
                                <div className="mt-2"><Bar value={g?.equalWeightRoi ?? null} max={0.2} /></div>
                                <div className="mt-1 text-xs text-zinc-500">{g ? `${g.positions.toLocaleString()} positions · won ${fmtPct(g.winRate, 0)} · on real bet sizes: ${fmtPct(g.roi)} (${fmtUsd(g.pnl)} on ${fmtUsd(g.staked)})` : 'no positions in this window'}</div>
                            </div>); })}
                    </div>
                    <div className="mt-4 rounded border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-100"><b>Verdict:</b> {verdict(wf)}</div>
                    <details className="mt-4 text-sm">
                        <summary className="cursor-pointer text-zinc-300 hover:text-white">Show the individual sharp wallets and how each did afterwards</summary>
                        <div className="mt-3 grid gap-4 md:grid-cols-2">
                            <div className="min-w-0"><H sub="what copying each one after the cutoff would have earned">After the cutoff</H>
                                <Table head={['wallet', 'positions', 'won', 'staked', 'P/L', 'ROI', 'equal-weight']} rows={wf.sharpPerWallet.map(r => [<WalletLink key="w" address={r.wallet} name={r.username} />, r.positions, fmtPct(r.winRate, 0), fmtUsd(r.staked), <span key="p" className={Number(r.pnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmtUsd(r.pnl)}</span>, fmtPct(r.roi), fmtPct(r.equalWeightRoi)])} /></div>
                            <div className="min-w-0"><H sub="why each one qualified">Before the cutoff</H>
                                <Table head={['wallet', <Term key="r" k="resolved" />, <Term key="c" k="calibrated ROI" />, <Term key="o" k="ROI" />, <Term key="p" k="p-value" />]} rows={wf.inSample.sharpList.map(s => [<WalletLink key="w" address={s.w} />, s.n, fmtPct(s.cal), fmtPct(s.roi), s.p.toFixed(3)])} />
                                <H>By category, after the cutoff</H>
                                <Table head={['category', 'positions', 'won', 'staked', 'P/L', 'ROI']} rows={Object.entries(wf.sharpByCategory).map(([c, g]) => [c, g.positions, fmtPct(g.winRate, 0), fmtUsd(g.staked), fmtUsd(g.pnl), fmtPct(g.roi)])} /></div>
                        </div>
                    </details>
                </div>
            ))}

            <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-sm leading-6 text-zinc-200">
                <b>What would change the verdict.</b> More wallets with history (63 today; a few hundred would make "sharp" a real group), longer history (90+ days instead of two weeks), ranking within a category instead of across everything, and a stricter cut (p under 0.01). Until then the Wallets page is a description of the past, not a forecast.
            </div>

            <H sub="simple rules replayed on stored hourly prices, fills at bar price plus slippage">Rule-based strategies</H>
            <p className="mb-3 text-sm text-zinc-400">These do not depend on wallets at all. Each is a fixed rule applied to every market with price history; the number shows what it would have earned on the last 90 days, sports excluded.</p>
            {strategies.length === 0 ? <Empty>No strategy backtest stored. Run <code>npx tsx scripts/pm-backtest.ts all 90 --no-sports</code>.</Empty> :
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {strategies.map(s => { const [label, desc] = STRAT_LABEL[s.strategy] ?? [s.strategy, '']; return (
                    <div key={s.strategy} className="min-w-0 rounded-lg border border-zinc-800 p-4">
                        <div className="mb-1 flex items-center justify-between"><span className="font-medium text-white">{label}</span><Pill tone={s.n === 0 ? 'zinc' : s.roi > 0 ? 'emerald' : 'rose'}>{s.n} trades</Pill></div>
                        <p className="mb-3 text-xs leading-5 text-zinc-400">{desc}</p>
                        {s.n === 0 ? <div className="text-sm text-zinc-500">The rule never triggered on the {s.markets} markets with price history. Not a failure, just no opportunities in this window.</div> :
                        <div className="grid grid-cols-2 gap-2">
                            <Stat label="Return" value={fmtPct(s.roi)} tone={s.roi > 0 ? 'pos' : 'neg'} sub={`${fmtUsd(s.pnl)} on ${fmtUsd(s.staked)}`} />
                            <Stat label="Won" value={fmtPct(s.winRate, 0)} sub={`worst drawdown ${fmtUsd(s.maxDrawdown)}`} />
                        </div>}
                        {s.trades.length > 0 && <div className="mt-3"><Table head={['market', 'side', 'entry', 'size', 'closed by', 'P/L']} rows={s.trades.slice(0, 6).map(t => [<MarketLink key="m" conditionId={t.conditionId ?? t.condition_id} question={t.question} />, t.outcomeIndex === 0 ? 'YES' : 'NO', Math.round(t.entryPrice * 100) + '¢', fmtUsd(t.usd), t.exitReason.replace(/_/g, ' '), <span key="p" className={t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmtUsd(t.pnl, 1)}</span>])} /></div>}
                        <div className="mt-2 text-[11px] text-zinc-600">tested {fmtTs(Date.parse(s.generatedAt) / 1000).slice(0, 16)} · {s.markets} markets · {s.days} days</div>
                    </div>); })}
            </div>}
            <p className="mt-4 text-xs text-zinc-500">Limits: Polymarket only serves about 30 days of hourly prices per market, so these replays are short. The thin-move rule needs volume from all wallets, which only the 20 most active markets have.</p>
        </div>
    );
}
