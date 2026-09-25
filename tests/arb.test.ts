import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts } from '../lib/pm/db';
import { multiOutcomeSum, parseThreshold, ladderViolations, logicalViolations, kalshiFee, matchVenues, crossVenueArbs, ruleDiff, applyCosts, annualize, titleTokens, ensureSchema } from '../lib/market/arb';

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); ensureSchema(); });
test.after(() => { closeDb(); _resetStmts(); });

test('multi-outcome sum: asks 0.30/0.30/0.30 → 10% edge on all-YES', () => {
    const ms = [1, 2, 3].map(i => ({ condition_id: `c${i}`, question: `Cand ${i}`, yes_price: 0.3, best_ask: 0.3, best_bid: 0.29, active: 1 }));
    const a = multiOutcomeSum(ms);
    const yes = a.find(x => x.kind === 'all_yes')!;
    assert.ok(yes); assert.ok(Math.abs(yes.sumAsk - 0.9) < 1e-9); assert.ok(Math.abs(yes.edge - 0.1) < 1e-9); assert.ok(Math.abs(yes.edgePct - 0.1 / 0.9) < 1e-9);
    // all-NO: no asks = 1 − bid = 0.71 each → 2.13 > payout 2 → no arb
    assert.ok(!a.find(x => x.kind === 'all_no'));
    // all-NO arb: bids 0.40 each → no ask 0.60 ×3 = 1.80 < 2 → edge 0.20
    const b = multiOutcomeSum(ms.map(m => ({ ...m, best_bid: 0.40, best_ask: 0.41 })));
    const no = b.find(x => x.kind === 'all_no')!;
    assert.ok(no); assert.ok(Math.abs(no.edge - 0.2) < 1e-9);
    // a placeholder leg (no bid, inactive) kills the arb entirely
    assert.equal(multiOutcomeSum([...ms, { condition_id: 'c4', question: 'Will A win', yes_price: 0.5, best_ask: 1, best_bid: null, active: 0 }]).length, 0);
});

test('threshold parsing + ladder violation', () => {
    assert.deepEqual(parseThreshold('Will Bitcoin be above $100,000 on Dec 31?'), { threshold: 100000, direction: 'above' });
    assert.deepEqual(parseThreshold('BTC below $90k by Friday?'), { threshold: 90000, direction: 'below' });
    assert.deepEqual(parseThreshold('Fed cuts 50 bps or more?'), { threshold: 50, direction: 'above' });
    assert.equal(parseThreshold('Will it rain tomorrow?'), null);
    const ms = [
        { event_id: 'e', condition_id: 'a', question: 'BTC above $100k?', yes_price: 0.40 },
        { event_id: 'e', condition_id: 'b', question: 'BTC above $110k?', yes_price: 0.45 }, // violation: higher threshold priced higher
        { event_id: 'e', condition_id: 'c', question: 'BTC above $120k?', yes_price: 0.20 },
        { event_id: 'e', condition_id: 'd', question: 'Map 3 Total Rounds: Over/Under 19.5', yes_price: 0.5 },
        { event_id: 'e', condition_id: 'f', question: 'Map 1 Total Rounds: Over/Under 20.5', yes_price: 0.01 } // different map → different ladder, no violation
    ];
    const v = ladderViolations(ms);
    assert.equal(v.length, 1); assert.equal(v[0].lower.condition_id, 'a'); assert.equal(v[0].higher.condition_id, 'b'); assert.ok(Math.abs(v[0].spread - 0.05) < 1e-9);
});

test('logical violations: earlier deadline ≤ later; presidency ≤ nomination', () => {
    const ms = [
        { condition_id: 'a', question: 'Will X resign by March 2027?', yes_price: 0.30 },
        { condition_id: 'b', question: 'Will X resign by June 2027?', yes_price: 0.25 },   // violation
        { condition_id: 'n', question: 'Will Jane Doe win the 2028 Democratic presidential nomination?', yes_price: 0.10 },
        { condition_id: 'p', question: 'Will Jane Doe win the 2028 presidential election?', yes_price: 0.12 } // violation
    ];
    const v = logicalViolations(ms);
    assert.equal(v.length, 2);
    assert.ok(v.some(x => x.rule === 'earlier_deadline_le_later' && x.narrower.condition_id === 'a' && Math.abs(x.spread - 0.05) < 1e-9));
    assert.ok(v.some(x => x.rule === 'presidency_le_nomination' && x.narrower.condition_id === 'p' && Math.abs(x.spread - 0.02) < 1e-9));
});

test('kalshi fee + cross-venue arb + costs', () => {
    assert.equal(kalshiFee(1, 0.5), 0.02);            // 0.07×0.25 = 0.0175 → ceil to cent = 0.02
    assert.equal(kalshiFee(100, 0.5), 1.75);
    const pm = [{ condition_id: 'c', question: 'Will the Fed cut rates in October 2026?', yes_price: 0.40, best_ask: 0.40, best_bid: 0.39, end_ts: 1_800_000_000, description: 'Resolves per federalreserve.gov statement on Oct 29, 2026.' }];
    const ks = [{ ticker: 'KXFED-26OCT', title: 'Fed cut rates October 2026?', subtitle: '', yes_ask: 0.45, yes_bid: 0.43, no_ask: 0.55, no_bid: 0.53, close_ts: 1_800_000_000 + 86400, rules: 'Resolves Yes if the FOMC lowers the target range at its October 29, 2026 meeting per the Fed press release.' },
                { ticker: 'KXNBA', title: 'Lakers win NBA finals', subtitle: '', yes_ask: 0.2, yes_bid: 0.1, no_ask: 0.9, no_bid: 0.8, close_ts: 1_900_000_000, rules: '' }];
    const m = matchVenues(pm, ks);
    assert.equal(m.length, 1); assert.equal(m[0].kalshi.ticker, 'KXFED-26OCT'); assert.ok(m[0].confidence >= 0.6);
    // YES pm 0.40 + NO kalshi 0.55 + fee(0.55)=ceil(0.07×0.2475×100)/100=0.02 → 0.97 → edge 0.03
    const arbs = crossVenueArbs(m, 0.001);
    assert.equal(arbs.length, 1); assert.equal(arbs[0].leg, 'buy_yes_pm_buy_no_kalshi'); assert.ok(Math.abs(arbs[0].cost - 0.97) < 1e-9); assert.ok(Math.abs(arbs[0].edge - 0.03) < 1e-9);
    const rd = ruleDiff(pm[0].description, ks[0].rules);
    assert.ok(rd.common.some(x => /oct/.test(x)));
    const c = applyCosts(30, 1000, 10, { pmWithdrawUsd: 5, kalshiWithdrawUsd: 0, slippageBps: 50, transferDays: 2 });
    assert.equal(c.costs, 10); assert.equal(c.netUsd, 20); assert.ok(Math.abs(c.annualized - annualize(0.02, 12)) < 1e-12);
    assert.ok(titleTokens('Will the Fed cut rates?').has('fed'));
});

test('deadline parsing: "July 2027" is later than "October 2026" (regression 2026-09-25)', () => {
    const v = logicalViolations([
        { condition_id: 'a', question: 'Fed rate cut by October 2026 meeting?', yes_price: 0.0085 },
        { condition_id: 'b', question: 'Fed rate cut by July 2027 meeting?', yes_price: 0.445 }
    ], 0.01);
    assert.equal(v.length, 0, 'earlier deadline priced below later deadline is consistent');
    const bad = logicalViolations([
        { condition_id: 'a', question: 'Fed rate cut by October 2026 meeting?', yes_price: 0.60 },
        { condition_id: 'b', question: 'Fed rate cut by July 2027 meeting?', yes_price: 0.40 }
    ], 0.01);
    assert.equal(bad.length, 1); assert.equal(bad[0].narrower.condition_id, 'a');
});

test('threshold parsing handles Kalshi "$81,000 or above" / "or below" (regression 2026-09-25)', () => {
    assert.deepEqual(parseThreshold('Bitcoin price on Sep 25, 2026? $81,000 or above'), { threshold: 81000, direction: 'above' });
    assert.deepEqual(parseThreshold('Bitcoin price on Sep 25, 2026? $81,000 or below'), { threshold: 81000, direction: 'below' });
    const m = matchVenues(
        [{ condition_id: 'a', question: 'Will the price of Bitcoin be above $90,000 on September 25?', yes_price: 0.01, best_bid: 0.005, best_ask: 0.01, end_ts: 1790370000, description: '' } as never],
        [{ ticker: 'KXBTCD-26SEP2517-T80999.99', title: 'Bitcoin price on Sep 25, 2026?', subtitle: '$81,000 or above', yes_ask: 0.99, yes_bid: 0.98, no_ask: 0.02, no_bid: 0.01, close_ts: 1790370000, rules: '' } as never], 0.5);
    assert.equal(m.length, 0, 'different strikes never match');
});

test('venue matching: numbers must agree as whole tokens on both sides', () => {
    const pm = (q: string) => ({ condition_id: q, question: q, yes_price: 0.5, best_bid: 0.49, best_ask: 0.51, end_ts: 1798779540, description: '' } as never);
    const k = (title: string, subtitle: string) => ({ ticker: title, title, subtitle, yes_ask: 0.5, yes_bid: 0.49, no_ask: 0.5, no_bid: 0.49, close_ts: 1798779540, rules: '' } as never);
    assert.equal(matchVenues([pm('Will Apple release a foldable iPhone before 2027?')], [k('Will Apple Inc. release iPhone 18 before Jan 1, 2027?', 'Before 2027')]).length, 0, 'iPhone 18 ≠ foldable iPhone');
    assert.equal(matchVenues([pm('Will Apple release iPhone 18 before 2027?')], [k('Will Apple Inc. release iPhone 18 before Jan 1, 2027?', 'Before 2027')]).length, 1, 'same product matches');
});
