import { journalPage } from '@/lib/ui/queries-report';
import { Stat, Table, H, Pill, MarketLink, fmtUsd, fmtPct, fmtCents, ago, Signed } from '@/components/intel/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function Journal({ searchParams }: { searchParams: { tab?: string } }) {
    const tab = searchParams.tab || 'entries';
    const { entries, tags, attribution, portfolio } = journalPage();
    const tabs = [['entries', 'Entries'], ['tags', 'Which reasons pay'], ['attribution', 'Attribution'], ['portfolio', 'Portfolio'], ['export', 'Export']];
    return (
        <div>
            <div className="flex flex-wrap gap-1">{tabs.map(([v, l]) => <a key={v} href={`/intel/journal?tab=${v}`} className={`rounded px-2 py-1 font-mono text-[12px] ${tab === v ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}>{l}</a>)}</div>
            {tab === 'entries' && (<><H sub="paper orders auto-journaled by scripts/pm-journal.ts sync; tags = strategy family, category, price bucket, signals within ±2h">Journal</H>
                <Table head={['when', 'strategy', 'market', 'side', 'price', 'usd', 'reasons', 'tags', 'outcome', 'P/L']} rows={entries.map(e => [ago(e.ts), String(e.strategy), <MarketLink key="m" conditionId={e.condition_id} question={e.question} />, `${e.side} ${e.outcome_index}`, fmtCents(e.price), fmtUsd(e.usd), <span key="r" className="text-zinc-400">{e.reasons.join(' | ').slice(0, 80)}</span>, <span key="t" className="text-zinc-400">{e.tags.join(' ')}</span>, e.outcome ? <Pill key="o" tone={e.outcome === 'WIN' ? 'emerald' : e.outcome === 'LOSS' ? 'rose' : 'zinc'}>{e.outcome}</Pill> : '—', e.pnl == null ? '—' : <Signed key="p" n={e.pnl} />])} empty="No journal entries. Run: npx tsx scripts/pm-journal.ts sync" /></>)}
            {tab === 'tags' && (<><H sub="per tag over entries with a known outcome">Which reasons actually make money</H>
                <Table head={['tag', 'n', 'resolved', 'hit rate', 'staked', 'P/L', 'ROI']} rows={tags.map(t => [t.tag, t.n, t.resolved, fmtPct(t.hitRate, 0), fmtUsd(t.staked), <Signed key="p" n={t.pnl} />, fmtPct(t.roi, 1)])} /></>)}
            {tab === 'attribution' && (<><H sub="skill = closing-line value (close − reference) × shares; slippage = −(fill − reference) × shares; luck = residual; sums to realized">Performance attribution</H>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <Stat label="Realized" value={<Signed n={attribution.total.realized} />} sub={`${attribution.total.n} closed orders`} />
                    <Stat label="Skill (CLV)" value={<Signed n={attribution.total.skill} />} />
                    <Stat label="Slippage" value={<Signed n={attribution.total.slippage} />} />
                    <Stat label="Fees" value={<Signed n={attribution.total.fees} />} />
                    <Stat label="Luck" value={<Signed n={attribution.total.luck} />} />
                </div>
                <div className="mt-3" />
                <Table head={['strategy', 'n', 'staked', 'realized', 'skill', 'slippage', 'fees', 'luck']} rows={attribution.byStrategy.map(a => [a.strategy, a.n, fmtUsd(a.staked), <Signed key="r" n={a.realized} />, <Signed key="s" n={a.skill} />, <Signed key="l" n={a.slippage} />, <Signed key="f" n={a.fees} />, <Signed key="k" n={a.luck} />])} empty="No closed paper orders yet." /></>)}
            {tab === 'portfolio' && (<><H sub={portfolio.kalshiNote}>Unified paper portfolio</H>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Open positions" value={portfolio.totals.n} />
                    <Stat label="Cost" value={fmtUsd(portfolio.totals.cost)} />
                    <Stat label="Marked value" value={fmtUsd(portfolio.totals.value)} />
                    <Stat label="Unrealized" value={<Signed n={portfolio.totals.unrealized} />} />
                </div>
                <H>By category</H>
                <Table head={['category', 'positions', 'cost', 'value', 'unrealized']} rows={portfolio.byCategory.map(c => [c.category, c.n, fmtUsd(c.cost), fmtUsd(c.value), <Signed key="u" n={c.unrealized} />])} />
                <H sub="markets in one event are correlated; neg-risk events are mutually exclusive">By event</H>
                <Table head={['event', 'positions', 'cost', 'value', 'unrealized']} rows={portfolio.byEvent.map(c => [c.event_slug, c.n, fmtUsd(c.cost), fmtUsd(c.value), <Signed key="u" n={c.unrealized} />])} />
                <H>Lines</H>
                <Table head={['strategy', 'venue', 'market', 'side', 'shares', 'entry', 'mark', 'cost', 'value', 'unrealized']} rows={portfolio.lines.map(l => [l.strategy, l.venue, <MarketLink key="m" conditionId={l.condition_id} question={l.question} slug={l.event_slug} />, l.outcome_index, l.shares.toFixed(0), fmtCents(l.entry), fmtCents(l.mark), fmtUsd(l.cost), fmtUsd(l.value), <Signed key="u" n={l.unrealized} />])} empty="No open paper positions." /></>)}
            {tab === 'export' && (<><H sub="closed/resolved paper orders; the country switch only changes the date format. Record export, not tax advice.">Tax / record export</H>
                <div className="flex gap-2"><a className="rounded bg-zinc-100 px-3 py-1 font-mono text-[12px] text-zinc-900" href="/api/intel/export/tax?country=ISO">download CSV (ISO dates)</a><a className="rounded bg-zinc-100 px-3 py-1 font-mono text-[12px] text-zinc-900" href="/api/intel/export/tax?country=US">download CSV (US dates)</a></div></>)}
        </div>
    );
}
