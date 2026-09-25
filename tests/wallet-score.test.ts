import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { openDb, closeDb, _resetStmts, run, get, DB_PATH } from '../lib/pm/db';
import { buildPositions, loadTrades, scorable, computeMetrics, scoreWallet, normalCdf, convictionSigma, positionLifecycle, edgeTrend, topWallets, consensus, divergence, persistScores } from '../lib/intel/wallet-score';

const W = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const W2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const T0 = 1_790_000_000;
let seq = 0;
function trade(wallet: string, cid: string, oi: number, side: 'BUY' | 'SELL', size: number, price: number, ts: number, slug = 'ev') {
    run(`INSERT INTO trades(id, wallet, condition_id, outcome_index, outcome, side, size, price, usdc, ts, event_slug, market_slug, title, asset, tx_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `t${++seq}`, wallet, cid, oi, oi === 0 ? 'Yes' : 'No', side, size, price, size * price, ts, slug, slug, `Q ${cid}`, 'a', `tx${seq}`);
}
function market(cid: string, winner: number | null, category = 'politics', endTs = T0 + 10 * 86_400, slug = 'ev') {
    run(`INSERT INTO markets(condition_id, event_slug, question, outcomes, category, end_ts, resolved, winner_index, closed, active, yes_price, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        cid, slug, `Q ${cid}`, '["Yes","No"]', category, endTs, winner === null ? 0 : 1, winner, winner === null ? 0 : 1, winner === null ? 1 : 0, 0.5, T0);
}

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); });
test.after(() => { closeDb(); _resetStmts(); });

test('math: normalCdf', () => {
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
    assert.ok(Math.abs(normalCdf(1.6449) - 0.95) < 1e-3);
    assert.ok(Math.abs(normalCdf(-1.6449) - 0.05) < 1e-3);
});

test('positions: pnl, roi, calibrated roi, brier, p-value on known trades', () => {
    // m1: buy 100 @0.20, wins  -> pnl +80, stake 20, roi 4.0
    // m2: buy 50 @0.80, loses  -> pnl -40, stake 40
    // m3: buy 100 @0.50, sell 40 @0.60, wins -> proceeds 24 + 60 held = 84 - 50 = +34
    // m4: open (unresolved) -> excluded from resolved metrics, counted in n_markets
    // m5: hedged: buy both sides -> excluded
    // scalp: excluded entirely
    market('0xm1', 0); market('0xm2', 1); market('0xm3', 0); market('0xm4', null); market('0xm5', 0);
    market('0xscalp', 0, 'crypto', T0 + 900, 'btc-updown-15m-1');
    trade(W, '0xm1', 0, 'BUY', 100, 0.20, T0);
    trade(W, '0xm2', 0, 'BUY', 50, 0.80, T0 + 100);
    trade(W, '0xm3', 0, 'BUY', 100, 0.50, T0 + 200); trade(W, '0xm3', 0, 'SELL', 40, 0.60, T0 + 3600);
    trade(W, '0xm4', 0, 'BUY', 10, 0.30, T0 + 300);
    trade(W, '0xm5', 0, 'BUY', 100, 0.50, T0 + 400); trade(W, '0xm5', 1, 'BUY', 100, 0.50, T0 + 401);
    trade(W, '0xscalp', 0, 'BUY', 100, 0.50, T0 + 500, 'btc-updown-15m-1');
    const ps = buildPositions(loadTrades(W));
    assert.equal(ps.length, 6, 'scalp dropped, hedge pair kept as 2 positions');
    const m1 = ps.find(p => p.conditionId === '0xm1')!; assert.equal(m1.pnl, 80); assert.equal(m1.won, true);
    const m3 = ps.find(p => p.conditionId === '0xm3')!; assert.ok(Math.abs(m3.pnl! - 34) < 1e-9);
    assert.ok(ps.filter(p => p.conditionId === '0xm5').every(p => p.hedged));
    const res = scorable(ps);
    assert.equal(res.length, 3);
    const m = computeMetrics(ps, res);
    assert.equal(m.n_markets, 6); assert.equal(m.n_resolved, 3); assert.equal(m.wins, 2);
    assert.ok(Math.abs(m.staked - 110) < 1e-9); assert.ok(Math.abs(m.pnl - 74) < 1e-9);
    assert.ok(Math.abs(m.roi! - 74 / 110) < 1e-9);
    // calibrated: risk = 20*sqrt(0.8/0.2) + 40*sqrt(0.2/0.8) + 50*sqrt(0.5/0.5) = 40 + 20 + 50 = 110 -> 74/110
    assert.ok(Math.abs(m.calibrated_roi! - 74 / 110) < 1e-9);
    // brier = ((0.2-1)^2 + (0.8-0)^2 + (0.5-1)^2)/3 = (0.64+0.64+0.25)/3
    assert.ok(Math.abs(m.brier! - 1.53 / 3) < 1e-9);
    // p-value: mean = 1.5, var = 0.16+0.16+0.25 = 0.57, z = 0.5/sqrt(0.57)
    const z = 0.5 / Math.sqrt(0.57); assert.ok(Math.abs(m.p_value! - (1 - normalCdf(z))) < 1e-6);
    assert.ok(Math.abs(m.longshot_share! - 1 / 3) < 1e-9); assert.ok(Math.abs(m.favorite_share! - 1 / 3) < 1e-9);
});

test('positions: sells beyond seen buys are capped', () => {
    market('0xcap', 0);
    trade(W2, '0xcap', 0, 'BUY', 10, 0.5, T0); trade(W2, '0xcap', 0, 'SELL', 50, 0.9, T0 + 10);
    const p = buildPositions(loadTrades(W2)).find(x => x.conditionId === '0xcap')!;
    assert.equal(p.sellShares, 10); assert.ok(Math.abs(p.pnl! - (9 - 5)) < 1e-9);
});

test('scoreWallet persists per category/window; lifecycle; conviction; edgeTrend', () => {
    const rows = scoreWallet(W);
    const all0 = rows.find(r => r.category === 'all' && r.window_days === 0)!;
    assert.equal(all0.n_resolved, 3);
    const pol = rows.find(r => r.category === 'politics' && r.window_days === 0)!;
    assert.equal(pol.n_resolved, 3);
    assert.ok(!rows.find(r => r.category === 'sports'));
    const db = get<{ n: number }>('SELECT COUNT(*) n FROM wallet_scores WHERE wallet = ?', W); assert.ok(db!.n >= 2);
    const lc = positionLifecycle(W, '0xm3', 0);
    assert.deepEqual(lc.map(s => s.action), ['entry', 'trim']);
    const lc5 = positionLifecycle(W, '0xm5', 0); assert.equal(lc5[0].action, 'entry');
    const c = convictionSigma(W, 1000); assert.equal(c.n, 7, "7 buys incl. the scalp; conviction reads raw trades"); assert.ok(c.ratio! > 10);
    assert.equal(edgeTrend(W).trend, 'insufficient');
});

test('topWallets / consensus / divergence on synthetic smart wallets', () => {
    // Make W a "smart" wallet artificially and add a crowd wallet on the other side of an open market.
    persistScores([{ wallet: W, category: 'all', window_days: 0, n_markets: 40, n_resolved: 40, wins: 30, staked: 1000, pnl: 500, roi: 0.5, calibrated_roi: 0.6, brier: 0.2, avg_entry_price: 0.5, longshot_share: 0.1, favorite_share: 0.1, p_value: 0.01, z: 2.3, entry_timing: null, conviction_sigma: null, computed_at: T0 }]);
    persistScores([{ wallet: W2, category: 'all', window_days: 0, n_markets: 40, n_resolved: 40, wins: 30, staked: 1000, pnl: 500, roi: 0.5, calibrated_roi: 0.6, brier: 0.2, avg_entry_price: 0.5, longshot_share: 0.1, favorite_share: 0.1, p_value: 0.01, z: 2.3, entry_timing: null, conviction_sigma: null, computed_at: T0 }]);
    const nowTs = Math.floor(Date.now() / 1000);
    market('0xopen', null, 'politics', nowTs + 86_400);
    trade(W, '0xopen', 0, 'BUY', 100, 0.4, nowTs - 600); trade(W2, '0xopen', 0, 'BUY', 100, 0.4, nowTs - 500);
    trade('0xcccccccccccccccccccccccccccccccccccccccc', '0xopen', 1, 'BUY', 1000, 0.6, nowTs - 400);
    const top = topWallets({ minResolved: 30, maxP: 0.1 }); assert.ok(top.some(t => t.wallet === W));
    const c = consensus({ windowHours: 1, persist: true }); assert.equal(c.length, 1); assert.equal(c[0].wallets.length, 2);
    assert.ok(get('SELECT 1 FROM signals WHERE type = ?', 'consensus'));
    const d = divergence({ windowHours: 1, persist: true }); assert.equal(d.length, 1); assert.ok(d[0].crowd_share_other > 0.99);
});

test('real DB (if populated): score a leaderboard wallet and sanity-check', () => {
    closeDb(); _resetStmts();
    if (!fs.existsSync(DB_PATH)) { console.log('skip: no data/polygloth.sqlite'); openDb(':memory:'); return; }
    openDb(DB_PATH);
    const w = get<{ n: number }>('SELECT COUNT(*) n FROM wallets WHERE trade_count > 0')!.n;
    const r = get<{ n: number }>('SELECT COUNT(*) n FROM markets WHERE resolved = 1')!.n;
    if (w < 5 || r < 100) { console.log(`skip: real DB has ${w} wallets / ${r} resolved markets`); closeDb(); _resetStmts(); openDb(':memory:'); return; }
    const top = get<{ address: string }>('SELECT address FROM wallets WHERE trade_count > 0 ORDER BY COALESCE(lb_rank_pnl_month, 9999) LIMIT 1')!;
    const rows = scoreWallet(top.address, { persist: false });
    const a = rows.find(x => x.category === 'all' && x.window_days === 0)!;
    assert.ok(a.n_markets > 0);
    if (a.n_resolved > 0) {
        assert.ok(a.wins <= a.n_resolved);
        assert.ok(a.staked > 0 && a.p_value! >= 0 && a.p_value! <= 1 && a.brier! >= 0 && a.brier! <= 1);
        const ps = scorable(buildPositions(loadTrades(top.address)));
        const pnl = ps.reduce((s, p) => s + p.pnl!, 0);
        assert.ok(Math.abs(pnl - a.pnl) < 1e-6, 'metrics pnl equals sum of position pnl');
    }
    console.log(`real: ${top.address.slice(0, 10)} markets=${a.n_markets} resolved=${a.n_resolved} wins=${a.wins} staked=${a.staked.toFixed(0)} pnl=${a.pnl.toFixed(0)} cal=${a.calibrated_roi?.toFixed(3)} p=${a.p_value?.toFixed(3)}`);
    closeDb(); _resetStmts(); openDb(':memory:');
});
