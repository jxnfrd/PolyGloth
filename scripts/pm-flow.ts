import { config } from 'dotenv'; config({ path: '.env.local' });
import { openDb, all, get } from '../lib/pm/db';
import { ingestMarketTrades, ingestPrices } from '../lib/pm/ingest';
import { aggressorImbalance, yesNetFlow, largeFillClusters, liveDepthMap, thinMove, marketMakerFootprint, resolutionDrift, marketTradesRows, ensureSchema, oiDivergence } from '../lib/market/microstructure';

// Usage: npx tsx scripts/pm-flow.ts <conditionId|top> [n=5]
(async () => {
    openDb(); ensureSchema();
    const [arg = 'top', nArg = '5'] = process.argv.slice(2);
    const cids = arg === 'top'
        ? all<{ condition_id: string }>('SELECT condition_id FROM markets WHERE closed = 0 AND is_sports = 0 AND yes_price > 0.05 AND yes_price < 0.95 ORDER BY volume24hr DESC LIMIT ?', Number(nArg)).map(r => r.condition_id)
        : [arg.toLowerCase()];
    for (const cid of cids) {
        const m = get<{ question: string; clob_token_ids: string; volume24hr: number; yes_price: number }>('SELECT question, clob_token_ids, volume24hr, yes_price FROM markets WHERE condition_id = ?', cid);
        console.log(`\n=== ${m?.question ?? cid} | yes ${m?.yes_price} | vol24 $${Math.round(m?.volume24hr ?? 0).toLocaleString()}`);
        await ingestMarketTrades(cid, 1500, x => console.log('  ' + x));
        const tok = (JSON.parse(m?.clob_token_ids || '[]') as string[])[0];
        if (tok) { try { await ingestPrices(tok, '1d', 5); } catch { /* ok */ } }
        const trades = marketTradesRows(cid);
        for (const im of aggressorImbalance(trades)) console.log(`  imbalance ${String(im.windowMin).padStart(3)}m outcome ${im.outcomeIndex}: ${(im.imbalance * 100).toFixed(0).padStart(4)}%  buy $${Math.round(im.buyUsd)} sell $${Math.round(im.sellUsd)} (n=${im.n})`);
        console.log(`  YES-equivalent net flow 60m: $${Math.round(yesNetFlow(trades))}`);
        for (const c of largeFillClusters(trades).slice(0, 3)) console.log(`  iceberg ${c.wallet.slice(0, 8)} ${c.side} idx${c.outcomeIndex} ×${c.n} avg ${Math.round(c.avgSize)} sh = $${Math.round(c.totalUsd)}`);
        if (tok) { const d = await liveDepthMap(tok); console.log(`  book bid ${d.bestBid} ask ${d.bestAsk} spread ${d.spread?.toFixed(3)} | buy depth ≤1¢ $${Math.round(d.buy.within1c)} ≤5¢ $${Math.round(d.buy.within5c)} | max $ at ≤1¢ impact: buy $${Math.round(d.buy.maxUsdAt1cImpact)} sell $${Math.round(d.sell.maxUsdAt1cImpact)}`); for (const f of d.fill) console.log(`    $${f.usd}: buy avg ${f.buyAvg.toFixed(3)} worst ${f.buyWorst.toFixed(3)} | sell avg ${f.sellAvg.toFixed(3)} worst ${f.sellWorst.toFixed(3)}`); }
        const tm = thinMove(cid); console.log(`  thin move: ${tm ? `${tm.moveCents}¢ on $${Math.round(tm.notionalUsd)} (${(tm.share * 100).toFixed(2)}% of 24h) → fade ${tm.fadeSide}` : 'none'}`);
        const mm = marketMakerFootprint(cid); if (mm.length) console.log(`  market makers: ${mm.map(x => `${x.wallet.slice(0, 8)} (${(x.buyShare * 100).toFixed(0)}%/${(x.sellShare * 100).toFixed(0)}%${x.quotingStopped ? ', QUOTING STOPPED' : ''})`).join(', ')}`);
        console.log(`  OI: ${JSON.stringify(oiDivergence(cid))}`);
    }
    console.log('\n=== resolution drift (last cents), top 10 by annualized yield ===');
    for (const d of resolutionDrift({ limit: 10 })) console.log(`  ${(d.annualized * 100).toFixed(0).padStart(5)}%/yr  ${d.side} @${d.price.toFixed(3)} ${d.daysToEnd}d  risk ${d.disputeRisk}  ${d.question.slice(0, 60)}${d.reasons.length ? '  [' + d.reasons.join('; ') + ']' : ''}`);
})().catch(e => { console.error(e); process.exit(1); });
