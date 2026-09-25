// Cross-check stored winners (CLOB) against Gamma's post-close outcomePrices for a random sample.
import { config } from 'dotenv'; config({ path: '.env.local', quiet: true });
import { openDb, all } from '../lib/pm/db';
import { getEventBySlug } from '../lib/pm/gamma';
openDb();
const rows = all<{ condition_id: string; event_slug: string; question: string; winner_index: number; outcomes: string }>(`SELECT condition_id, event_slug, question, winner_index, outcomes FROM markets WHERE resolved = 1 AND event_slug != '' AND is_sports = 0 ORDER BY RANDOM() LIMIT 40`);
(async () => {
let agree = 0, disagree = 0, unknown = 0;
for (const r of rows) {
    const ev = await getEventBySlug(r.event_slug, 0);
    const m = ev?.markets.find(x => x.conditionId === r.condition_id);
    if (!m || !m.outcomePrices.length || !m.closed) { unknown++; continue; }
    const gammaWinner = m.outcomePrices.indexOf(Math.max(...m.outcomePrices));
    const decisive = Math.max(...m.outcomePrices) >= 0.99;
    if (!decisive) { unknown++; continue; }
    if (gammaWinner === r.winner_index) agree++; else { disagree++; console.log('DISAGREE', r.question.slice(0, 60), '| stored', r.winner_index, JSON.parse(r.outcomes)[r.winner_index], '| gamma', m.outcomePrices); }
}
console.log({ sampled: rows.length, agree, disagree, unknown });
})();
