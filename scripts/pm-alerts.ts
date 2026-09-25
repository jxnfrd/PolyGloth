import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb } from '../lib/pm/db';
import { seedDefaults, evaluate, deliver, listRules, listAlerts } from '../lib/alerts/alerts';

/** Usage: npx tsx scripts/pm-alerts.ts [evaluate [hours=24] | deliver | list | seed] */
(async () => {
    openDb();
    const [cmd = 'evaluate', a1] = process.argv.slice(2);
    if (cmd === 'seed') { console.log('seeded', seedDefaults()); return; }
    if (cmd === 'list') { console.table(listRules().map(r => ({ id: r.id, name: r.name, enabled: r.enabled, rule: JSON.stringify(r.rule) }))); console.table(listAlerts(30).map(a => ({ id: a.id, rule: a.rule_name, when: new Date(a.ts * 1000).toISOString().slice(0, 16), delivered: a.delivered, summary: a.summary.slice(0, 110) }))); return; }
    if (cmd === 'evaluate') { seedDefaults(); const since = Math.floor(Date.now() / 1000) - (Number(a1) || 24) * 3600; const created = evaluate(since); console.log(`${created.length} new alerts`); for (const a of created) console.log(' ', a.summary); const d = await deliver(); console.log(d); return; }
    if (cmd === 'deliver') { console.log(await deliver()); return; }
    throw new Error(`unknown command ${cmd}`);
})().catch(e => { console.error(e); process.exit(1); });
