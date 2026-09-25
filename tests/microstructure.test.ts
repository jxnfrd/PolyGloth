import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts, run, now } from '../lib/pm/db';
import { listMarkets } from '../lib/pm/gamma';
import { orderBook } from '../lib/pm/clob';
import { aggressorImbalance, yesNetFlow, largeFillClusters, depthMap, spoofSuspects, thinMove, marketMakerFootprint, resolutionDrift, ensureSchema } from '../lib/market/microstructure';

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); ensureSchema(); });
test.after(() => { closeDb(); _resetStmts(); });

const t0 = now();
const tr = (wallet: string, oi: number, side: string, size: number, price: number, ts: number) => ({ wallet, outcome_index: oi, side, size, price, usdc: size * price, ts });

test('aggressor imbalance: 3 buys 1 sell equal size → +0.5', () => {
    const trades = [tr('a', 0, 'BUY', 100, 0.5, t0 - 60), tr('b', 0, 'BUY', 100, 0.5, t0 - 50), tr('c', 0, 'BUY', 100, 0.5, t0 - 40), tr('d', 0, 'SELL', 100, 0.5, t0 - 30)];
    const im = aggressorImbalance(trades, t0, [5]);
    assert.equal(im.length, 1); assert.equal(im[0].imbalance, 0.5); assert.equal(im[0].buyUsd, 150); assert.equal(im[0].sellUsd, 50);
    // YES-equivalent: BUY NO counts as −
    assert.equal(yesNetFlow([tr('a', 0, 'BUY', 100, 0.5, t0 - 10), tr('b', 1, 'BUY', 100, 0.5, t0 - 10)], t0, 60), 0);
    assert.equal(yesNetFlow([tr('a', 1, 'SELL', 100, 0.4, t0 - 10)], t0, 60), 40);
});

test('large-fill clustering', () => {
    const trades = [tr('w', 0, 'BUY', 500, 0.5, t0 - 100), tr('w', 0, 'BUY', 520, 0.5, t0 - 90), tr('w', 0, 'BUY', 490, 0.5, t0 - 80), tr('w', 0, 'BUY', 5000, 0.5, t0 - 70), tr('x', 0, 'BUY', 500, 0.5, t0 - 60)];
    const cl = largeFillClusters(trades, 3);
    assert.equal(cl.length, 1); assert.equal(cl[0].n, 3); assert.equal(cl[0].wallet, 'w'); assert.ok(Math.abs(cl[0].totalUsd - 755) < 1e-9);
});

test('depth map math on a synthetic book', () => {
    const book = { tokenId: 'x', bids: [{ price: 0.50, size: 1000 }, { price: 0.49, size: 1000 }], asks: [{ price: 0.51, size: 1000 }, { price: 0.52, size: 1000 }, { price: 0.60, size: 10000 }], bestBid: 0.5, bestAsk: 0.51, mid: 0.505, spread: 0.01, fetchedAt: t0 };
    const d = depthMap(book, [100, 1000]);
    assert.equal(d.buy.within1c, 0.51 * 1000 + 0.52 * 1000);           // asks ≤ 0.52
    assert.equal(d.buy.within5c, 0.51 * 1000 + 0.52 * 1000);           // 0.60 is 9¢ away
    // avg ≤ 0.52: 0.51×1000 + 0.52×1000 = $1030 for 2000 sh (avg 0.515), plus x of the 0.60 level until (1030+x)/(2000+x/0.6) = 0.52 → x = 75 → $1105
    assert.ok(Math.abs(d.buy.maxUsdAt1cImpact - 1105) < 1, `max at 1c impact = ${d.buy.maxUsdAt1cImpact}`);
    assert.equal(d.fill[0].buyAvg, 0.51);
    assert.ok(Math.abs(d.fill[1].buyAvg - (510 + 490) / (1000 + 490 / 0.52)) < 1e-9);
});

test('spoof detector: vanished 5× level with no trades', () => {
    const before = { bids: [{ price: 0.5, size: 100 }, { price: 0.49, size: 100 }, { price: 0.48, size: 2000 }], asks: [{ price: 0.51, size: 100 }] };
    const after = { bids: [{ price: 0.5, size: 100 }, { price: 0.49, size: 100 }], asks: [{ price: 0.51, size: 100 }] };
    const s = spoofSuspects(before, after, []);
    assert.equal(s.length, 1); assert.equal(s[0].price, 0.48); assert.equal(s[0].side, 'bid');
    // same vanish but explained by trades → not a spoof
    assert.equal(spoofSuspects(before, after, [tr('z', 0, 'SELL', 2000, 0.48, t0)]).length, 0);
});

test('thin move + MM footprint + drift on synthetic DB rows', () => {
    run('INSERT INTO events(id, slug, title, tags, category, updated_at) VALUES (?,?,?,?,?,?)', 'E', 'ev', 'ev', '[]', 'politics', t0);
    run('INSERT INTO markets(condition_id, event_id, event_slug, question, description, outcomes, clob_token_ids, yes_price, best_ask, end_ts, closed, resolved, volume24hr, is_sports, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        '0xm', 'E', 'ev', 'Will X happen by December 2026?', 'Resolves YES per https://example.gov official statement.', '["Yes","No"]', '["tokY","tokN"]', 0.95, 0.96, t0 + 5 * 86400, 0, 0, 100000, 0, t0);
    // price path: 0.40 → 0.50 in 30 min on $500 notional (< 2% of 100k)
    run('INSERT INTO prices(token_id, ts, price) VALUES (?,?,?)', 'tokY', t0 - 1800, 0.40);
    run('INSERT INTO prices(token_id, ts, price) VALUES (?,?,?)', 'tokY', t0 - 60, 0.50);
    run('INSERT INTO trades(id, wallet, condition_id, outcome_index, outcome, side, size, price, usdc, ts) VALUES (?,?,?,?,?,?,?,?,?,?)', 't1', '0xa', '0xm', 0, 'Yes', 'BUY', 1000, 0.5, 500, t0 - 120);
    const tm = thinMove('0xm', { at: t0 });
    assert.ok(tm, 'thin move detected'); assert.equal(tm!.moveCents, 10); assert.equal(tm!.fadeSide, 'NO'); assert.equal(tm!.notionalUsd, 500);
    // MM: wallet mm does 60% of buys and 60% of sells, net ~0
    const rows = [['m1', '0xmm', 0, 'BUY', 600, 0.5, t0 - 900], ['m2', '0xmm', 0, 'SELL', 600, 0.5, t0 - 800], ['m3', '0xdir', 0, 'BUY', 400, 0.5, t0 - 700], ['m4', '0xdir2', 0, 'SELL', 400, 0.5, t0 - 600]] as const;
    for (const r of rows) run('INSERT INTO trades(id, wallet, condition_id, outcome_index, outcome, side, size, price, usdc, ts) VALUES (?,?,?,?,?,?,?,?,?,?)', r[0], r[1], '0xm2', r[2], 'Yes', r[3], r[4], r[5], r[4] * r[5], r[6]);
    const mm = marketMakerFootprint('0xm2');
    assert.equal(mm.length, 1); assert.equal(mm[0].wallet, '0xmm'); assert.equal(mm[0].netShares, 0); assert.ok(Math.abs(mm[0].buyShare - 0.6) < 1e-9);
    // drift: YES at ask 0.96, 5 days → gross 4.1667%, annualized ≈ 3.04
    const d = resolutionDrift({ maxDays: 14 });
    assert.equal(d.length, 1); assert.equal(d[0].side, 'YES'); assert.ok(Math.abs(d[0].grossYield - (0.04 / 0.96)) < 1e-9); assert.ok(Math.abs(d[0].annualized - (0.04 / 0.96) * (365 / 5)) < 0.02);
});

test('live: depth map on a real order book', async () => {
    // The top market can be mid-game with an empty book; use the first of the top 10 with a two-sided book.
    const candidates = await listMarkets({ limit: 10, active: true, closed: false, order: 'volume24hr' });
    let book = await orderBook(candidates[0].clobTokenIds[0]);
    for (const c of candidates.slice(1)) { if (book.bids.length && book.asks.length) break; book = await orderBook(c.clobTokenIds[0]); }
    assert.ok(book.bids.length && book.asks.length, 'found a two-sided book in the top 10');
    const d = depthMap(book);
    assert.ok(d.bestAsk! > d.bestBid!);
    assert.ok(d.buy.within5c >= d.buy.within1c && d.buy.within1c >= 0);
    assert.ok(d.buy.maxUsdAt1cImpact >= d.buy.within1c - 1e-6, 'every level within 1¢ of best is fillable at ≤1¢ average impact');
});
