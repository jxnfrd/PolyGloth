import { config } from 'dotenv'; config({ path: '.env.local' });
import { fetchActiveMarkets } from '../lib/intelligence/polymarket';
import { extractKeywords } from '../lib/intelligence/orchestrator';
import { WhaleTracker } from '../lib/intelligence/whale-tracker';
import { buildKeywordQuery } from '../lib/intelligence/gdelt-advanced';
(async () => {
  console.log('=== fetchActiveMarkets(8, no sports, >=50k vol) ===');
  const ms = await fetchActiveMarkets(8);
  for (const m of ms) console.log(`${Math.round(m.yesPrice*100).toString().padStart(3)}% | vol ${Math.round(m.volume).toLocaleString().padStart(11)} | ${m.slug.slice(0,45).padEnd(45)} | ${m.question.slice(0,55)} | kw=${JSON.stringify(extractKeywords(m.question))} | gdelt="${buildKeywordQuery(extractKeywords(m.question))}"`);
  console.log('\n=== WhaleTracker (read-only) ===');
  const wt = new WhaleTracker({ log: () => {} });
  const lb = await wt.fetchLeaderboard(5, 'pnl', 'month');
  for (const t of lb) {
    const pos = await wt.fetchOpenPositions(t.proxyWallet, 1000);
    const real = pos.filter(p => !/updown|up-or-down/i.test(p.eventSlug));
    console.log(`#${t.rank} ${t.userName.slice(0,18).padEnd(18)} pnl $${Math.round(t.pnl).toLocaleString().padStart(9)} | open>=1k: ${pos.length} (non-scalp ${real.length})`);
    for (const p of real.slice(0,3)) console.log(`    ${p.title.slice(0,45).padEnd(45)} | ${p.outcome.padEnd(12)} | paid $${Math.round(p.initialValue).toLocaleString()} now $${Math.round(p.currentValue).toLocaleString()} | entry ${p.avgPrice} now ${p.curPrice} | strength ${WhaleTracker.strength(p, t.rank)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
