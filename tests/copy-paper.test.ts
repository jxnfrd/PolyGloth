import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts, run, all, get } from '../lib/pm/db';
import { ensureSchema, decideCopy, pollLeaders, settlePaper, cancelAllPaper, paperReport, copyLagReport, frontRunDetection, leaderDumpingAlert, rebalanceBasket, leaderBankroll, DEFAULT_COPY_CONFIG, CopyConfig } from '../lib/exec/copy-paper';

const L = '0xleader000000000000000000000000000000001';
const cfg: CopyConfig = { ...DEFAULT_COPY_CONFIG, strategy: 'test_copy', myBankroll: 10_000, maxPriceOffsetCents: 2, perTradeCap: 500, dailyCap: 700, perMarketCap: 600, minLiquidityUsd: 1000 };

function trade(id: string, cid: string, idx: number, side: 'BUY' | 'SELL', size: number, price: number, ts: number, wallet = L, slug = 'ev-1') {
    run('INSERT INTO trades(id, wallet, condition_id, outcome_index, outcome, side, size, price, usdc, ts, event_slug, market_slug, title, asset, tx_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, wallet, cid, idx, idx === 0 ? 'Yes' : 'No', side, size, price, size * price, ts, slug, 'm', `Q ${cid}`, 'tok', id);
}

test.before(() => {
    closeDb(); _resetStmts(); openDb(':memory:'); ensureSchema();
    run("INSERT INTO markets(condition_id, question, category, liquidity, yes_price, best_bid, best_ask, resolved, event_slug, clob_token_ids) VALUES ('0xm1','Q m1','politics',50000,0.50,0.49,0.51,0,'ev-1','[\"tokY\",\"tokN\"]')");
    run("INSERT INTO markets(condition_id, question, category, liquidity, yes_price, best_bid, best_ask, resolved, event_slug) VALUES ('0xm2','Q m2','sports',50000,0.30,0.29,0.31,0,'ev-2')");
    run("INSERT INTO markets(condition_id, question, category, liquidity, yes_price, resolved, event_slug) VALUES ('0xthin','Q thin','politics',100,0.50,0,'ev-3')");
    // leader bankroll: 30d BUY usdc = 1000 + 1000 = 2000 (below)
});
test.after(() => { closeDb(); _resetStmts(); });

test('decideCopy: sizing, caps, offset, category, liquidity', () => {
    const m = { category: 'politics', liquidity: 50000, yes_price: 0.5, best_bid: 0.49, best_ask: 0.51, resolved: 0, winner_index: null };
    const t = { id: 't', wallet: L, condition_id: '0xm1', outcome_index: 0, side: 'BUY', size: 2000, price: 0.50, usdc: 1000, ts: 1, event_slug: 'ev-1', title: 'Q' };
    // leader bankroll 2000, trade 1000 = 50 % of bankroll → 50 % of my 10k = 5000 → capped to perTradeCap 500
    const d = decideCopy(t, m, cfg, { leaderBankroll: 2000, openInMarket: 0, spentToday: 0, mid: 0.50 });
    assert.ok(d.ok && d.usd === 500 && d.price === 0.50 && Math.abs(d.size - 1000) < 1e-9);
    // per-market cap: 600 − 400 open = 200
    const d2 = decideCopy(t, m, cfg, { leaderBankroll: 2000, openInMarket: 400, spentToday: 0, mid: 0.50 });
    assert.ok(d2.ok && d2.usd === 200);
    // daily cap: 700 − 650 = 50
    const d3 = decideCopy(t, m, cfg, { leaderBankroll: 2000, openInMarket: 0, spentToday: 650, mid: 0.50 });
    assert.ok(d3.ok && d3.usd === 50);
    // price moved past offset (0.50 + 0.02 = 0.52 cap; mid 0.53)
    assert.deepEqual(decideCopy(t, m, cfg, { leaderBankroll: 2000, openInMarket: 0, spentToday: 0, mid: 0.53 }), { ok: false, reason: 'price_moved' });
    // within offset fills at mid
    const d4 = decideCopy(t, m, cfg, { leaderBankroll: 2000, openInMarket: 0, spentToday: 0, mid: 0.515 });
    assert.ok(d4.ok && d4.price === 0.515);
    assert.equal((decideCopy(t, m, { ...cfg, categoryFilter: ['sports'] }, { leaderBankroll: 2000, openInMarket: 0, spentToday: 0, mid: 0.5 }) as { reason: string }).reason, 'category');
    assert.equal((decideCopy(t, { ...m, liquidity: 10 }, cfg, { leaderBankroll: 2000, openInMarket: 0, spentToday: 0, mid: 0.5 }) as { reason: string }).reason, 'liquidity');
    assert.equal((decideCopy({ ...t, side: 'SELL' }, m, cfg, { leaderBankroll: 2000, openInMarket: 0, spentToday: 0, mid: 0.5 }) as { reason: string }).reason, 'not_buy');
    assert.equal((decideCopy({ ...t, event_slug: 'btc-updown-5m-1' }, m, cfg, { leaderBankroll: 2000, openInMarket: 0, spentToday: 0, mid: 0.5 }) as { reason: string }).reason, 'scalp');
    const fixed = decideCopy(t, m, { ...cfg, fixedUsdPerTrade: 120 }, { leaderBankroll: 0, openInMarket: 0, spentToday: 0, mid: 0.5 });
    assert.ok(fixed.ok && fixed.usd === 120);
});

test('pollLeaders → paper orders, exit mirroring, settlement, kill switch, reports', () => {
    const t0 = 1_800_000_000;
    trade('t1', '0xm1', 0, 'BUY', 2000, 0.50, t0 - 20 * 86_400);        // $1000 (bankroll)
    trade('t2', '0xm2', 0, 'BUY', 3333.33, 0.30, t0 - 10 * 86_400);      // $1000 (bankroll)
    trade('t3', '0xm1', 0, 'BUY', 400, 0.50, t0 - 3600);                 // $200 → 10 % of 2000×... bankroll = 2200 → 200/2200×10000 = 909 → cap 500
    trade('t4', '0xthin', 0, 'BUY', 100, 0.50, t0 - 3500);               // liquidity reject
    trade('t5', '0xm1', 0, 'SELL', 400, 0.55, t0 - 1800);                // exit mirroring → close at 0.55
    trade('t6', '0xm2', 0, 'BUY', 100, 0.30, t0 - 600);                  // $30 → 30/2280*10000 = 131.6; mid 0.30 → fill
    assert.ok(Math.abs(leaderBankroll(L, t0) - 2280) < 0.01, `bankroll ${leaderBankroll(L, t0)}`); // 1000 + 1000 + 200 + 50 + 30

    const r = pollLeaders([{ address: L }], cfg, t0);
    assert.equal(r.seen, 4, 't1/t2 are older than the 1h initial lookback and must not be replayed');
    assert.equal(r.placed, 2);
    assert.equal(r.rejected.liquidity, 1);
    assert.equal(r.closed, 1, 'exit mirrored the SELL');
    const closed = get<{ price: number; size: number; usd: number; close_price: number; pnl: number }>("SELECT price, size, usd, close_price, pnl FROM paper_orders WHERE condition_id='0xm1' AND status='closed'");
    assert.ok(closed);
    // bankroll 2280 → 200/2280×10000 = 877 → cap 500 @0.50 → 1000 shares; close 0.55 → pnl 1000×0.55−500 = 50
    assert.equal(closed!.usd, 500); assert.ok(Math.abs(closed!.pnl - 50) < 1e-6);
    // second poll sees nothing new
    const r2 = pollLeaders([{ address: L }], cfg, t0);
    assert.equal(r2.seen, 0);
    // resolve m2 YES → open order on m2 settles as win: usd 134.5 @0.30 → shares 448.4 → pnl 313.9
    run("UPDATE markets SET resolved=1, winner_index=0, end_ts=? WHERE condition_id='0xm2'", t0);
    assert.equal(settlePaper('test_copy'), 1);
    const res = get<{ usd: number; size: number; pnl: number }>("SELECT usd, size, pnl FROM paper_orders WHERE condition_id='0xm2' AND status='resolved'")!;
    assert.ok(Math.abs(res.pnl - (res.size - res.usd)) < 1e-9 && res.pnl > 0);
    const rep = paperReport().find(x => x.strategy === 'test_copy')!;
    assert.equal(rep.closed, 1); assert.equal(rep.resolved, 1); assert.equal(rep.rejected, 1); assert.equal(rep.hitRate, 1);
    // copy-lag: our pnl on m2 vs leader realized on m2 (leader bought 3433.33 sh for $1030, held → won → pnl 2403.33)
    const lag = copyLagReport('test_copy');
    assert.equal(lag.length, 1); assert.equal(lag[0].markets, 1);
    assert.ok(Math.abs(lag[0].leaderPnl - (3433.33 - 1030)) < 0.01, `leader pnl ${lag[0].leaderPnl}`);
    assert.ok(Math.abs(lag[0].offsetCost) < 1e-9, 'filled at leader price → no offset cost');
    // kill switch on a fresh open order
    trade('t7', '0xm1', 0, 'BUY', 100, 0.50, t0 + 10);
    pollLeaders([{ address: L }], cfg, t0 + 20);
    assert.equal(cancelAllPaper('test_copy', t0 + 30), 1);
    assert.equal(all("SELECT 1 FROM paper_orders WHERE strategy='test_copy' AND status='open'").length, 0);
});

test('front-run detection and leader-dumping alert', () => {
    const t0 = 1_800_100_000;
    const O = '0xother00000000000000000000000000000000002';
    // price trail from other wallets: 0.40 then leader buys at 0.43 (rose 3¢ within 10 min) → pre-run
    trade('o1', '0xm1', 0, 'BUY', 10, 0.40, t0 - 300, O);
    trade('l1', '0xm1', 0, 'BUY', 100, 0.43, t0, L);
    // second leader buy with flat pre-price
    trade('o2', '0xm2', 0, 'BUY', 10, 0.30, t0 + 100, O);
    trade('l2', '0xm2', 0, 'BUY', 100, 0.30, t0 + 200, L);
    const fr = frontRunDetection(L, 1, 2, 600, t0 + 300);
    assert.equal(fr.measurable, 2); assert.equal(fr.preRun, 1); assert.equal(fr.share, 0.5);
    // dumping: leader buys, others pile in, leader sells within 60 min
    trade('l3', '0xm1', 1, 'BUY', 1000, 0.50, t0 + 1000, L);
    trade('o3', '0xm1', 1, 'BUY', 500, 0.52, t0 + 1500, O);
    trade('l4', '0xm1', 1, 'SELL', 1000, 0.54, t0 + 2000, L);
    const d = leaderDumpingAlert(L, 1, 3600, t0 + 3000);
    assert.equal(d.length, 1); assert.equal(d[0].othersBuyBetween, 260); assert.equal(d[0].othersBuyBefore, 0);
});

test('rebalanceBasket caps at 25 % and drops non-positive', () => {
    const t0 = 1_800_200_000;
    // wallet_scores present for 5 wallets: scores 5,4,3,2,1 and one negative
    const ws = [['0xa', 5], ['0xb', 4], ['0xc', 3], ['0xd', 2], ['0xe', 1], ['0xf', -1]] as [string, number][];
    for (const [w, s] of ws) run("INSERT INTO wallet_scores(wallet, category, window_days, n_resolved, calibrated_roi, computed_at) VALUES (?,'all',30,50,?,?)", w, s, t0);
    const b = rebalanceBasket(ws.map(x => x[0]), 30, t0);
    const sum = b.reduce((s, x) => s + x.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    assert.ok(b.every(x => x.weight <= 0.25 + 1e-9));
    assert.equal(b.find(x => x.address === '0xf')!.weight, 0);
    assert.equal(b.find(x => x.address === '0xa')!.weight, 0.25);
    assert.ok(b.find(x => x.address === '0xe')!.weight > 0);
});
