import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts, get } from '../lib/pm/db';
import { nearCertaintyHarvester, deadlineDecay, thinMoveReversion, aiProbabilityStrategy, fairAfterElapsed, Snapshot } from '../lib/exec/strategies';
import { runBacktestOn, fillOrder, maxDrawdown, flagsFor, runBacktest, BtMarketInput } from '../lib/exec/backtest';

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); });
test.after(() => { closeDb(); _resetStmts(); });

const H = 3600;
const base = (over: Partial<Snapshot> = {}): Snapshot => ({ conditionId: '0x1', ts: 1_000_000, question: 'Will X happen by June?', category: 'politics', yesPrice: 0.5, endTs: 1_000_000 + 5 * 86_400, liquidity: 50_000, volume24h: 100_000, volume1h: 500, history: [{ t: 1_000_000 - H, p: 0.5 }, { t: 1_000_000, p: 0.5 }], flags: {}, ...over });

test('strategies decide correctly on synthetic snapshots', () => {
    const h = nearCertaintyHarvester();
    assert.equal(h.decide(base({ yesPrice: 0.98 }), false)[0].outcomeIndex, 0);
    assert.equal(h.decide(base({ yesPrice: 0.02 }), false)[0].outcomeIndex, 1, 'NO at 98¢');
    assert.equal(h.decide(base({ yesPrice: 0.98, endTs: 1_000_000 + 30 * 86_400 }), false).length, 0, 'too far from end');
    assert.equal(h.decide(base({ yesPrice: 0.98, flags: { ambiguousRules: true } }), false).length, 0, 'flagged');
    assert.equal(h.decide(base({ yesPrice: 0.98 }), true).length, 0, 'already open');

    // fair after elapsed: p0=0.5, half the time gone → 1 − 0.5^0.5 = 0.2929
    assert.ok(Math.abs(fairAfterElapsed(0.5, 0.5) - 0.29289) < 1e-4);
    const d = deadlineDecay();
    const t0 = 1_000_000, end = t0 + 10 * 86_400;
    const hist = [{ t: t0, p: 0.5 }, { t: t0 + 6 * 86_400, p: 0.5 }];
    const o = d.decide(base({ ts: t0 + 6 * 86_400, endTs: end, history: hist, yesPrice: 0.5 }), false);
    assert.equal(o.length, 1); assert.equal(o[0].outcomeIndex, 1); assert.equal(o[0].price, 0.5);   // fair ≈ 0.242 → 0.5 overpriced
    assert.equal(d.decide(base({ ts: t0 + 6 * 86_400, endTs: end, history: hist, yesPrice: 0.28 }), false).length, 0, 'within margin');
    assert.equal(d.decide(base({ ts: t0 + 6 * 86_400, endTs: end, history: hist, yesPrice: 0.5, question: 'Who wins?' }), false).length, 0, 'not a by-date question');

    const tm = thinMoveReversion();
    const up = base({ yesPrice: 0.60, history: [{ t: 1_000_000 - 2 * H, p: 0.50 }, { t: 1_000_000 - H, p: 0.50 }, { t: 1_000_000, p: 0.60 }], volume24h: 100_000, volume1h: 500 });
    const to = tm.decide(up, false);
    assert.equal(to.length, 1); assert.equal(to[0].outcomeIndex, 1, 'fade an up-move with NO'); assert.equal(to[0].price, 0.4);
    assert.ok(Math.abs(to[0].takeProfit! - 0.45) < 1e-9, 'NO target = 1 − 0.55');
    assert.equal(tm.decide({ ...up, volume1h: 5000 }, false).length, 0, 'move on real volume is not faded');

    const ai = aiProbabilityStrategy(() => 0.7);
    const ao = ai.decide(base({ yesPrice: 0.5 }), false)[0];
    assert.equal(ao.outcomeIndex, 0); assert.equal(ao.usd, 500, 'kelly (0.7−0.5)/0.5=0.4 × ¼ × 10k = 1000 → capped 500');
    const ao2 = aiProbabilityStrategy(() => 0.7, { maxUsd: 5000 }).decide(base({ yesPrice: 0.5 }), false)[0];
    assert.ok(Math.abs(ao2.usd - 1000) < 1e-9);
});

test('fill model and drawdown', () => {
    const f = fillOrder({ side: 'BUY', outcomeIndex: 0, price: 0.5, usd: 100, reason: '' }, 0.5, 100, 500, null);
    assert.ok(Math.abs(f.price - 0.505) < 1e-12 && f.usd === 100);
    const book = { bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.51, size: 100 }, { price: 0.55, size: 1000 }] };
    const g = fillOrder({ side: 'BUY', outcomeIndex: 0, price: 0.5, usd: 100, reason: '' }, 0.5, 0, 500, book);
    // 100 sh @0.51 = $51, then $49 @0.55 → avg = 100/(100+89.09) = 0.5289
    assert.ok(Math.abs(g.usd - 100) < 1e-9 && Math.abs(g.price - 0.5289) < 1e-3);
    const n = fillOrder({ side: 'BUY', outcomeIndex: 1, price: 0.5, usd: 30, reason: '' }, 0.5, 0, 500, book);
    assert.ok(Math.abs(n.price - 0.52) < 1e-12, 'NO ask = 1 − YES bid');
    assert.equal(maxDrawdown([0, 10, 5, 20, -5, 30]), 25);
});

test('backtester: synthetic path with known resolution → exact P/L', () => {
    const t0 = 1_000_000, end = t0 + 3 * 86_400;
    const hist = [0.90, 0.95, 0.975, 0.98, 0.985, 0.99].map((p, i) => ({ t: t0 + i * H, p }));
    const m: BtMarketInput = { condition_id: '0xw', question: 'Q', category: 'politics', tokenId: '', liquidity: 50_000, volume24hr: 10_000, end_ts: end, winner_index: 0, neg_risk: 0, uma_status: '', description: 'Resolves YES if ...', resolution_source: 'AP', history: hist, volumeFn: () => 1000 };
    const r = runBacktestOn([m], nearCertaintyHarvester({ maxUsd: 100 }), { slippage: 0, feeBps: 0, maxUsd: 100 });
    assert.equal(r.n, 1);
    const t = r.trades[0];
    assert.equal(t.entryPrice, 0.975);                 // first bar in [0.97, 0.99]
    assert.ok(Math.abs(t.shares - 100 / 0.975) < 1e-9);
    assert.ok(Math.abs(t.pnl - (100 / 0.975 - 100)) < 1e-9);   // +2.564
    assert.equal(t.exitReason, 'resolved_win');
    assert.ok(Math.abs(r.roi - 0.02564) < 1e-4);
    // same path, but NO wins → lose the stake
    const lose = runBacktestOn([{ ...m, winner_index: 1 }], nearCertaintyHarvester({ maxUsd: 100 }), { slippage: 0, feeBps: 0, maxUsd: 100 });
    assert.equal(lose.trades[0].pnl, -100); assert.equal(lose.winRate, 0);
    // fees: 100 bps on entry → pnl reduced by 1
    const fee = runBacktestOn([m], nearCertaintyHarvester({ maxUsd: 100 }), { slippage: 0, feeBps: 100, maxUsd: 100 });
    assert.ok(Math.abs(fee.trades[0].pnl - (100 / 0.975 - 101)) < 1e-9);
    // thin move with take-profit exit
    const th = [0.50, 0.50, 0.60, 0.56, 0.54, 0.54].map((p, i) => ({ t: t0 + i * H, p }));
    const m2: BtMarketInput = { ...m, condition_id: '0xtm', question: 'Q2', history: th, volumeFn: (a, b) => (b - a > H ? 100_000 : 500), winner_index: 0 };
    const r2 = runBacktestOn([m2], thinMoveReversion({ maxUsd: 100, fadeFraction: 1 }), { slippage: 0, feeBps: 0, maxUsd: 100 });
    assert.equal(r2.n, 1); assert.equal(r2.trades[0].outcomeIndex, 1); assert.equal(r2.trades[0].entryPrice, 0.4);
    assert.equal(r2.trades[0].exitReason, 'take_profit');           // NO target 0.45 hit at YES 0.54 (NO = 0.46)
    assert.ok(Math.abs(r2.trades[0].pnl - (100 / 0.4 * 0.46 - 100)) < 1e-9);  // +15
    assert.deepEqual(flagsFor({ uma_status: 'disputed', description: 'x', resolution_source: '', neg_risk: 1 }), { umaDisputeHistory: true, ambiguousRules: false, thinResolutionSource: true, multiOutcomeNegRisk: true });
});

test('runBacktest over the DB (no data in memory → 0 markets, no crash)', () => {
    const r = runBacktest({ strategy: nearCertaintyHarvester(), days: 30 });
    assert.equal(r.markets, 0); assert.equal(r.n, 0);
    assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM prices')!.n, 0);
});
