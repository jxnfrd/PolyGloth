import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts, run } from '../lib/pm/db';
import { kelly, kellyNo, fractionalKelly, bestSide, ev, kalshiFee, polymarketFee, liquidityAdjustedSize, resolutionHaircut, scoreCalibrationFrom, logEstimate, settleCalibration, scoreCalibration, scenarioPnl, breaker, tiltDetector, annualizedReturn, ensureSchema } from '../lib/exec/risk';

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); ensureSchema(); });
test.after(() => { closeDb(); _resetStmts(); });

test('kelly / ev', () => {
    assert.ok(Math.abs(kelly(0.6, 0.5) - 0.2) < 1e-12);       // (0.6-0.5)/(1-0.5)
    assert.equal(kelly(0.5, 0.6), 0);                         // no edge → 0
    assert.ok(Math.abs(kellyNo(0.3, 0.5) - 0.4) < 1e-12);     // NO: q'=0.7, p'=0.5 → 0.2/0.5
    assert.ok(Math.abs(fractionalKelly(0.6, 0.5, 0.25) - 0.05) < 1e-12);
    assert.ok(Math.abs(ev(0.6, 0.5) - 0.1) < 1e-12);
    const bs = bestSide(0.6, 0.5); assert.equal(bs.side, 'YES'); assert.ok(Math.abs(bs.kelly - 0.2) < 1e-12 && Math.abs(bs.ev - 0.1) < 1e-12);
    assert.equal(bestSide(0.3, 0.5).side, 'NO');
    assert.equal(bestSide(0.5, 0.5).side, 'NONE');
});

test('fees', () => {
    // Kalshi: 0.07 × 100 × 0.5 × 0.5 = 1.75 → $1.75; 0.07 × 10 × 0.9 × 0.1 = 0.063 → rounds UP to $0.07
    assert.equal(kalshiFee(100, 0.5), 1.75);
    assert.equal(kalshiFee(10, 0.9), 0.07);
    assert.equal(kalshiFee(100, 0.5) > kalshiFee(100, 0.2), true, 'peaks at 50c');
    assert.equal(polymarketFee(1000), 0);
    assert.equal(polymarketFee(1000, 100), 10);
});

test('liquidity-adjusted size walks the book', () => {
    const asks = [{ price: 0.50, size: 1000 }, { price: 0.52, size: 1000 }, { price: 0.60, size: 5000 }];
    // fair 0.56, margin 0.02 → cap avg 0.54. Level 1 = $500 @0.50, level 2 = $520 @0.52 → all of both: avg = 1020/2000 = 0.51 ≤ 0.54.
    // Adding level 3 at 0.60 pushes avg above 0.54 once enough is taken: max usd where avg ≤ 0.54.
    const r = liquidityAdjustedSize(asks, 0.56, 0.02, 100_000);
    assert.ok(r.avgPrice <= 0.54 + 1e-6 && r.avgPrice > 0.53, `avg ${r.avgPrice}`);
    assert.ok(r.usd > 1020 && r.usd < 2500, `usd ${r.usd}`);
    // hand check: taking x USD at 0.60 on top of 2000 shares/$1020: avg = (1020+x)/(2000+x/0.6) = 0.54 → x = 1710 → total 2730? solve: 1020+x = 1080 + 0.9x → 0.1x = 60 → x = 600 → usd 1620
    assert.ok(Math.abs(r.usd - 1620) < 2, `expected ≈1620, got ${r.usd}`);
    assert.deepEqual(liquidityAdjustedSize(asks, 0.50, 0.02, 1000), { usd: 0, shares: 0, avgPrice: 0 });
    assert.equal(liquidityAdjustedSize(asks, 0.56, 0.02, 300).usd, 300, 'maxUsd cap');
});

test('resolution haircut is a product of explicit factors', () => {
    assert.equal(resolutionHaircut({}), 1);
    assert.equal(resolutionHaircut({ ambiguousRules: true }), 0.5);
    assert.ok(Math.abs(resolutionHaircut({ ambiguousRules: true, canCloseEarly: true }) - 0.4) < 1e-12);
});

test('calibration: brier, log loss, bins, and DB round-trip', () => {
    const rows = [
        { prob_estimate: 0.9, market_price: 0.8, outcome: 1 },
        { prob_estimate: 0.2, market_price: 0.3, outcome: 0 },
        { prob_estimate: 0.7, market_price: 0.5, outcome: 0 }
    ];
    const r = scoreCalibrationFrom(rows);
    // brier = (0.01 + 0.04 + 0.49)/3 = 0.18 ; market = (0.04 + 0.09 + 0.25)/3 = 0.12666
    assert.ok(Math.abs(r.brier - 0.18) < 1e-9);
    assert.ok(Math.abs(r.marketBrier - 0.38 / 3) < 1e-9);
    assert.equal(r.n, 3);
    assert.equal(r.bins[9].n, 1); assert.equal(r.bins[2].n, 1); assert.equal(r.bins[7].n, 1);
    assert.equal(r.bins[7].observed, 0);
    // DB: log two estimates, resolve the market, settle
    run("INSERT INTO markets(condition_id, question, resolved, winner_index) VALUES ('0xabc','q',1,0)");
    logEstimate('me', '0xabc', 0, 0.8, 0.6); logEstimate('me', '0xabc', 1, 0.3, 0.4);
    assert.equal(settleCalibration(), 2);
    const s = scoreCalibration('me');
    assert.equal(s.n, 2);
    assert.ok(Math.abs(s.brier - ((0.2 ** 2) + (0.3 ** 2)) / 2) < 1e-9);
});

test('scenario P/L on a 2-market neg-risk event', () => {
    // Event E (neg risk): A and B mutually exclusive. Hold 100 YES-A at 0.40 ($40) and 50 YES-B at 0.30 ($15).
    const pos = [{ conditionId: 'A', outcomeIndex: 0, shares: 100, cost: 40 }, { conditionId: 'B', outcomeIndex: 0, shares: 50, cost: 15 }];
    const ev = (cid: string) => ({ eventKey: 'E', negRisk: true });
    const r = scenarioPnl(pos, ev);
    const byLabel = Object.fromEntries(r.scenarios.map(s => [s.label, s.pnl]));
    assert.equal(byLabel['A → YES'], 100 - 40 + (0 - 15));   // A wins: +60 on A, −15 on B = 45
    assert.equal(byLabel['B → YES'], (0 - 40) + (50 - 15));  // B wins: −40 + 35 = −5
    assert.equal(byLabel['A → NO'], -40);                    // only A resolves NO; B unmentioned
    assert.equal(r.worst!.pnl, -40);
    assert.equal(r.exposureByEvent[0].netAtRisk, 55);
});

test('breaker, tilt, annualized return', () => {
    const t0 = 1_800_000_000;
    const ev = [{ ts: t0 - 3600, pnl: -600 }, { ts: t0 - 2 * 86_400, pnl: -500 }];
    assert.equal(breaker(ev, { dailyLossLimit: 500, weeklyLossLimit: 5000 }, t0).halted, true);
    assert.equal(breaker(ev, { dailyLossLimit: 1000, weeklyLossLimit: 1000 }, t0).halted, true, 'weekly −1100');
    assert.equal(breaker(ev, { dailyLossLimit: 1000, weeklyLossLimit: 2000 }, t0).halted, false);
    const closes = [{ ts: 10, pnl: -5 }, { ts: 20, pnl: 5 }, { ts: 30, pnl: -5 }, { ts: 40, pnl: 5 }, { ts: 50, pnl: -5 }, { ts: 60, pnl: 5 }];
    const orders = [{ ts: 11, usd: 200 }, { ts: 21, usd: 100 }, { ts: 31, usd: 200 }, { ts: 41, usd: 100 }, { ts: 51, usd: 200 }, { ts: 61, usd: 100 }];
    const tilt = tiltDetector(orders, closes);
    assert.equal(tilt.afterLoss, 200); assert.equal(tilt.afterWin, 100); assert.equal(tilt.tilted, true);
    // 5¢ edge on a 50¢ contract over 36.5 days → (0.1) / (0.1) = 1.0 = 100 %/yr
    assert.ok(Math.abs(annualizedReturn(0.05, 0.5, t0 + 36.5 * 86_400, t0) - 1) < 1e-9);
});
