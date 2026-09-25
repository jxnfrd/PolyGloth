import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb } from '../lib/pm/db';
import { earlyResolutionScan, clarificationAlerts, disputeProneMarkets, headlineGap, headlineGapLlm, seedSourceWatch, checkSources, resolutionHistory, ensureSchema } from '../lib/market/resolution';

// Usage: npx tsx scripts/pm-resolution.ts [--llm] [--sources]
(async () => {
    openDb(); ensureSchema();
    const llm = process.argv.includes('--llm'), sources = process.argv.includes('--sources');
    console.log('=== early-resolution scanner (decided but not at 0/1) ===');
    const er = await earlyResolutionScan(60);
    for (const e of er.slice(0, 15)) console.log(`  gap ${e.gapCents}¢ winner=${e.winnerOutcome} price ${e.yes_price} [${e.source}${e.uma_status ? ' ' + e.uma_status : ''}] risk ${e.disputeRisk.score}  ${e.question.slice(0, 60)}`); if (!er.length) console.log('  none');
    console.log('\n=== clarification alerts (rules changed, 7d) ===');
    const ca = clarificationAlerts(); for (const a of ca.slice(0, 10)) console.log(`  ${new Date(a.ts * 1000).toISOString().slice(0, 16)} ${a.question.slice(0, 50)}\n    − ${a.diff.removed.join(' / ').slice(0, 200)}\n    + ${a.diff.added.join(' / ').slice(0, 200)}`); if (!ca.length) console.log('  none');
    console.log('\n=== dispute-prone active markets (score ≥ 40) ===');
    for (const m of disputeProneMarkets(40, 15)) { const g = headlineGap(m.question, m.description); console.log(`  ${String(m.score).padStart(3)}  ${m.question.slice(0, 60)}  [${m.reasons.join('; ')}]${g.flags.length ? '\n       headline gap: ' + g.flags.join('; ') : ''}`); if (llm) console.log('       llm:', JSON.stringify((await headlineGapLlm(m.question, m.description)).llm).slice(0, 300)); }
    console.log('\n=== past-resolution base rates (binary markets) ===');
    for (const h of resolutionHistory().filter(x => x.category === 'all')) console.log(`  ${h.pattern.padEnd(16)} n=${String(h.n).padStart(4)}  YES ${(h.yesShare * 100).toFixed(0)}%`);
    if (sources) { console.log('\n=== resolution source monitor ==='); console.log(`  seeded ${seedSourceWatch()} new URLs`); const r = await checkSources(30, m => console.log('  ' + m)); console.log(`  checked ${r.checked}, changed ${r.changed.length}`); for (const c of r.changed) console.log(`  CHANGED ${c.url} (${c.condition_id.slice(0, 10)})`); }
})().catch(e => { console.error(e); process.exit(1); });
