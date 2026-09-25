import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts, all, get } from '../lib/pm/db';
import { listMarkets, getEventBySlug, listComments, listEvents } from '../lib/pm/gamma';
import { leaderboard, walletTrades, walletPositions } from '../lib/pm/data-api';
import { clobMarket, orderBook, walkBook, depthWithin, priceHistory } from '../lib/pm/clob';
import { kalshiMarkets, kalshiTrades } from '../lib/pm/kalshi';
import { categorize } from '../lib/pm/categories';
import { upsertEvent, insertTrades, ingestResolutions, dbStats } from '../lib/pm/ingest';

// All tests run against an in-memory DB and the live public APIs (no keys).
test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); });
test.after(() => { closeDb(); _resetStmts(); });

test('gamma: markets ordered by real 24h volume, numeric prices', async () => {
    const ms = await listMarkets({ limit: 5, active: true, closed: false, order: 'volume24hr', volumeNumMin: 50_000 });
    assert.ok(ms.length >= 3);
    for (let i = 1; i < ms.length; i++) assert.ok(ms[i - 1].volume24hr >= ms[i].volume24hr, 'sorted desc by volume24hr');
    for (const m of ms) {
        assert.match(m.conditionId, /^0x[0-9a-f]{64}$/);
        assert.equal(m.outcomePrices.length, m.outcomes.length);
        assert.ok(m.outcomePrices.every(p => p >= 0 && p <= 1));
        assert.ok(m.volume >= 50_000);
        assert.equal(m.clobTokenIds.length, m.outcomes.length);
    }
});

test('gamma: event by slug carries tags + markets; category mapping', async () => {
    const ev = await getEventBySlug('fed-decision-in-october-20260617190323537');
    assert.ok(ev, 'event found');
    assert.ok(ev!.markets.length >= 1);
    assert.ok(ev!.tags.length >= 1);
    assert.equal(categorize(ev!.tags, ev!.slug, ev!.title), 'economy');
    assert.equal(categorize([], 'nfl-nyg-la-2026-09-22', 'Spread'), 'sports');
    assert.equal(categorize(['Bitcoin'], 'bitcoin-above-100k', ''), 'crypto');
    assert.equal(categorize([], 'btc-updown-15m-1774679400', 'Bitcoin Up or Down'), 'crypto');
});

test('gamma: comments expose proxyWallet', async () => {
    const evs = await listEvents({ limit: 1, active: true, closed: false, order: 'commentCount' });
    assert.ok(evs.length);
    const cs = await listComments(evs[0].id, 5);
    assert.ok(cs.length >= 1);
    assert.match(cs[0].proxyWallet, /^0x[0-9a-f]{40}$/);
    assert.ok(cs[0].body.length > 0);
});

test('data-api: leaderboard, wallet trades, positions', async () => {
    const lb = await leaderboard('month', 'pnl', 3);
    assert.equal(lb.length, 3);
    assert.match(lb[0].proxyWallet, /^0x[0-9a-f]{40}$/);
    assert.ok(lb[0].pnl >= lb[1].pnl);
    const trades = await walletTrades(lb[0].proxyWallet, 600);
    assert.ok(trades.length > 0);
    for (let i = 1; i < Math.min(50, trades.length); i++) assert.ok(trades[i - 1].timestamp >= trades[i].timestamp, 'newest first');
    const t = trades[0];
    assert.ok(['BUY', 'SELL'].includes(t.side));
    assert.ok(t.price > 0 && t.price < 1);
    assert.ok(Math.abs(t.usdc - t.size * t.price) < 1e-6);
    const pos = await walletPositions(lb[0].proxyWallet, 500);
    assert.ok(Array.isArray(pos));
});

test('clob: resolved market has a winner; book walk math', async () => {
    const m = await clobMarket('0xab906170ebd92007ac5cb8ae5cb4b6fce5ac1ee75d625ced3aab59ab944b0149'); // Spread: Rams (-6.5), resolved
    assert.ok(m && m.resolved && m.winnerIndex === 0, 'Rams -6.5 resolved to index 0');
    // The single top market can be mid-game with an empty book; take the first of the top 10 with a two-sided book.
    const candidates = await listMarkets({ limit: 10, active: true, closed: false, order: 'volume24hr' });
    let live = candidates[0]; let book = await orderBook(live.clobTokenIds[0]);
    for (const c of candidates.slice(1)) { if (book.bids.length && book.asks.length) break; live = c; book = await orderBook(c.clobTokenIds[0]); }
    assert.ok(book.bids.length && book.asks.length, 'found a two-sided book in the top 10');
    assert.ok(book.bestBid! < book.bestAsk!);
    const w = walkBook(book.asks, 'BUY', 1000);
    assert.ok(w.shares > 0 && w.avgPrice >= book.bestAsk! && w.worstPrice >= w.avgPrice - 1e-9);
    assert.ok(depthWithin(book.asks, 'BUY', 5) >= depthWithin(book.asks, 'BUY', 1));
    const hist = await priceHistory(live.clobTokenIds[0], '1d', 60);
    assert.ok(hist.length > 5 && hist.every(h => h.p >= 0 && h.p <= 1));
});

test('kalshi: public markets + trades in dollars', async () => {
    const { markets } = await kalshiMarkets({ limit: 5, status: 'open' });
    assert.ok(markets.length >= 1);
    assert.ok(markets.every(m => m.yesAsk >= 0 && m.yesAsk <= 1 && m.ticker));
    const { trades } = await kalshiTrades({ limit: 3 });
    assert.ok(trades.length >= 1 && trades[0].yesPrice > 0 && trades[0].yesPrice < 1);
});

test('db: upsert event/markets, insert trades idempotent, resolutions', async () => {
    const ev = await getEventBySlug('nfl-nyg-la-2026-09-22');
    assert.ok(ev);
    upsertEvent(ev!);
    upsertEvent(ev!); // idempotent
    const mk = all<{ condition_id: string; category: string; resolved: number }>('SELECT condition_id, category, resolved FROM markets');
    assert.ok(mk.length >= 5);
    assert.ok(mk.every(m => m.category === 'sports'));
    const lb = await leaderboard('month', 'pnl', 1);
    const trades = await walletTrades(lb[0].proxyWallet, 200);
    const n1 = insertTrades(trades); const n2 = insertTrades(trades);
    assert.equal(n1, trades.length); assert.equal(n2, 0, 'second insert inserts nothing');
    const r = await ingestResolutions(500, 0);
    assert.ok(r.resolved >= 1, 'closed NFL markets resolve via CLOB');
    const rams = get<{ winner_index: number }>('SELECT winner_index FROM markets WHERE condition_id = ?', '0xab906170ebd92007ac5cb8ae5cb4b6fce5ac1ee75d625ced3aab59ab944b0149');
    assert.equal(rams?.winner_index, 0);
    const s = dbStats();
    assert.ok(s.trades > 0 && s.markets > 0);
});
