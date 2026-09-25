import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb } from '../lib/pm/db';
import { scanMultiOutcome, scanLadders, scanLogical, scanCrossVenue, matchReport, ruleDiff, ruleDiffLlm, ingestKalshiEvents, ensureSchema } from '../lib/market/arb';

// Usage: npx tsx scripts/pm-arb.ts [--live] [--llm] [--no-kalshi-fetch]
(async () => {
    openDb(); ensureSchema();
    const live = process.argv.includes('--live'), llm = process.argv.includes('--llm');
    if (!process.argv.includes('--no-kalshi-fetch')) await ingestKalshiEvents(25, m => console.log(m));
    console.log('=== multi-outcome sum arbs (neg-risk events) ===');
    const mo = await scanMultiOutcome({ live, limit: 300 });
    for (const a of mo.slice(0, 15)) console.log(`  ${a.kind.padEnd(7)} edge ${(a.edgePct * 100).toFixed(2)}% (${(a.annualized * 100).toFixed(0)}%/yr, ${a.daysToEnd}d) Σask ${a.sumAsk.toFixed(3)} legs ${a.legs.length}${a.maxSizeUsd !== undefined ? ` max $${Math.round(a.maxSizeUsd)}/leg` : ''}  ${a.event_slug}`);
    if (!mo.length) console.log('  none');
    console.log('\n=== ladder violations ===');
    const lad = scanLadders(); for (const v of lad.slice(0, 15)) console.log(`  +${(v.spread * 100).toFixed(1)}pp  ${v.event_slug}: "${v.lower.question.slice(0, 40)}" ${v.lower.pYes} vs "${v.higher.question.slice(0, 40)}" ${v.higher.pYes}`); if (!lad.length) console.log('  none');
    console.log('\n=== logical violations ===');
    const lg = scanLogical(); for (const v of lg.slice(0, 15)) console.log(`  ${v.rule} +${(v.spread * 100).toFixed(1)}pp: "${v.narrower.question.slice(0, 50)}" ${v.narrower.pYes} > "${v.broader.question.slice(0, 50)}" ${v.broader.pYes}`); if (!lg.length) console.log('  none');
    console.log('\n=== kalshi match report (top 15 by confidence) ===');
    const mr = matchReport(); for (const m of mr.slice(0, 15)) console.log(`  ${(m.confidence * 100).toFixed(0)}% ov ${(m.overlap * 100).toFixed(0)}% Δd ${m.dayDiff === null ? '-' : m.dayDiff.toFixed(1)} | PM "${m.pm.question.slice(0, 45)}" y=${m.pm.yes_price} | K ${m.kalshi.ticker} "${m.kalshi.title.slice(0, 40)}" ask ${m.kalshi.yes_ask}`); console.log(`  ${mr.length} matches total`);
    console.log('\n=== cross-venue arbs (confidence ≥ 0.55, net of Kalshi fee) ===');
    const cv = scanCrossVenue(0.005, 0.55);
    for (const a of cv.slice(0, 10)) { console.log(`  ${a.leg} edge ${(a.edge * 100).toFixed(2)}¢ (${(a.annualized * 100).toFixed(0)}%/yr) cost ${a.cost.toFixed(3)} conf ${(a.match.confidence * 100).toFixed(0)}% | ${a.match.pm.question.slice(0, 50)} ↔ ${a.match.kalshi.ticker}`); const d = ruleDiff(a.match.pm.description, a.match.kalshi.rules); console.log(`    rule facts PM-only: ${d.pmOnly.slice(0, 4).join(' | ') || '-'} || Kalshi-only: ${d.kalshiOnly.slice(0, 4).join(' | ') || '-'}`); if (llm) console.log('    llm:', JSON.stringify(await ruleDiffLlm(a.match.pm.description, a.match.kalshi.rules)).slice(0, 400)); }
    if (!cv.length) console.log('  none');
})().catch(e => { console.error(e); process.exit(1); });
