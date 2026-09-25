import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb, all, get } from '../lib/pm/db';
import { eventSentiment, refreshComments, ensureSchema } from '../lib/market/sentiment';

// Usage: npx tsx scripts/pm-sentiment.ts <eventSlug|top> [maxComments=300] [positionFetchLimit=20]
(async () => {
    openDb(); ensureSchema();
    const [arg = 'top', maxC = '300', posLimit = '20'] = process.argv.slice(2);
    let ids: { id: string; slug: string }[] = [];
    if (arg === 'top') ids = all<{ id: string; slug: string }>(`SELECT id, slug FROM events WHERE closed = 0 AND id NOT LIKE 'missing:%' ORDER BY comment_count DESC LIMIT 5`);
    else { const e = get<{ id: string; slug: string }>('SELECT id, slug FROM events WHERE slug = ?', arg); if (!e) throw new Error(`event ${arg} not in DB (run pm-ingest events first)`); ids = [e]; }
    for (const e of ids) {
        const n = await refreshComments([e.id], Number(maxC), m => console.log('  ' + m));
        const r = await eventSentiment(e.id, { positionFetchLimit: Number(posLimit) });
        console.log(`\n=== ${r.slug} — ${r.title}`);
        console.log(`comments stored: ${r.nComments} (+${n} new) | yes_price ${r.yesPrice} | stance YES/NO/neutral = ${r.stanceCounts.YES}/${r.stanceCounts.NO}/${r.stanceCounts.neutral}`);
        console.log(`24h YES-share ${r.gap.yesShare === null ? '-' : (r.gap.yesShare * 100).toFixed(0) + '%'} (n=${r.gap.n}) gap vs price ${r.gap.gap === null ? '-' : (r.gap.gap * 100).toFixed(0) + 'pp'} | velocity last hour ${r.velocity.lastHour} vs mean ${r.velocity.meanHourly.toFixed(2)} (z=${r.velocity.z.toFixed(1)}) | mood index ${r.mood.index.toFixed(2)} (${r.mood.side}) | rules-lawyer comments ${r.rulesLawyers}`);
        for (const d of r.divergent.slice(0, 5)) console.log(`  DIVERGENT ${d.name || d.wallet.slice(0, 8)} says ${d.stance} holds ${d.heldSide}: "${d.body.slice(0, 100)}"`);
        for (const l of r.leaks.slice(0, 5)) console.log(`  LEAK [${l.leak.join(',')}] ${l.name || l.wallet.slice(0, 8)}: "${l.body.slice(0, 100)}"`);
        for (const s of r.shills) console.log(`  SHILL x${s.wallets.length}: "${s.bodies[0].slice(0, 80)}"`);
        for (const s of r.smart.slice(0, 3)) console.log(`  SMART (${(s.calibrated_roi * 100).toFixed(0)}% cROI) ${s.name}: "${s.body.slice(0, 100)}"`);
    }
})().catch(e => { console.error(e); process.exit(1); });
