import { recentSignals } from '@/lib/ui/queries';
import { openDb, all } from '@/lib/pm/db';
import { Table, H, MarketLink, ago, Empty, Pill, fmtCents, fmtUsd, fmtTs, Sentence, Term } from '@/components/intel/ui';
import { describeSignal } from '@/lib/ui/explain';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type P = Record<string, unknown>;
const p = (r: Record<string, unknown>) => (r.payload ?? {}) as P;

function ambiguousRules() {
    openDb();
    // Cheap heuristic view; lib/market/resolution.ts has the full scorer (scripts/pm-resolution.ts writes signals).
    return all<Record<string, unknown>>(
        `SELECT condition_id, question, event_slug, category, yes_price, volume24hr, end_ts, resolution_source,
                (CASE WHEN description LIKE '%sole discretion%' THEN 30 ELSE 0 END + CASE WHEN description LIKE '%credible reporting%' OR description LIKE '%consensus of%' THEN 25 ELSE 0 END
               + CASE WHEN resolution_source = '' OR resolution_source IS NULL THEN 15 ELSE 0 END + CASE WHEN description LIKE '%50/50%' OR description LIKE '%50-50%' THEN 20 ELSE 0 END
               + CASE WHEN uma_status LIKE '%dispute%' THEN 40 ELSE 0 END) risk
           FROM markets WHERE resolved = 0 AND closed = 0 AND volume24hr > 10000 AND is_sports = 0 ORDER BY risk DESC, volume24hr DESC LIMIT 40`);
}

export default function Resolution() {
    const early = recentSignals('early_resolution', 50), rules = recentSignals('rules_changed', 50), src = recentSignals('source_changed', 30);
    const amb = ambiguousRules();
    return (
        <div>
            <H sub="the exchange already knows the winner, but the price has not gone to $1 or $0">Decided but not priced</H>
            {early.length === 0 ? <Empty>No early-resolution signals. Run <code>npx tsx scripts/pm-resolution.ts</code>.</Empty> :
            <Table head={['when', 'what happened', 'market']}
                rows={early.map(r => [ago(r.ts), <Sentence key="s">{describeSignal(r as never)}</Sentence>, <MarketLink key="m" conditionId={r.condition_id} question="open" />])} />}
            <H sub="Polymarket edited the resolution text; prices usually lag a clarification">Rules edited</H>
            <Table head={['when', 'market', 'before', 'after']}
                rows={rules.map(r => [ago(r.ts), <MarketLink key="m" conditionId={r.condition_id} question={p(r).question} />, <span key="b" className="whitespace-normal text-zinc-500">{String(p(r).before).slice(0, 160)}</span>, <span key="a" className="whitespace-normal text-zinc-200">{String(p(r).after).slice(0, 160)}</span>])}
                empty="No rule changes detected since ingestion started." />
            <H sub="resolution-source URLs whose content hash changed (scripts/pm-resolution.ts --sources)">Source changes</H>
            <Table head={['when', 'market', 'url']} rows={src.map(r => [ago(r.ts), <MarketLink key="m" conditionId={r.condition_id} />, <a key="u" className="text-sky-300 hover:underline" href={String(p(r).url)} target="_blank" rel="noreferrer">{String(p(r).url).slice(0, 80)}</a>])} />
            <H sub="how vague the rules are: no named source, 'credible reporting', discretion clauses, 50/50 outs, open disputes. Higher = more likely to resolve against the headline">Markets with vague rules (non-sports, active)</H>
            <Table head={['market', 'category', 'yes price', '24h volume', 'ends', 'named source', <Term key="r" k="dispute risk" />]}
                rows={amb.map(m => [<MarketLink key="m" conditionId={m.condition_id} question={m.question} slug={m.event_slug} />, String(m.category), fmtCents(m.yes_price), fmtUsd(m.volume24hr), fmtTs(m.end_ts).slice(0, 10), String(m.resolution_source || '—').slice(0, 40), <Pill key="r" tone={Number(m.risk) >= 50 ? 'rose' : Number(m.risk) >= 25 ? 'amber' : 'zinc'}>{String(m.risk)}</Pill>])} />
        </div>
    );
}
