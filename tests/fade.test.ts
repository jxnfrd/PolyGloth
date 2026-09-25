import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { openDb, closeDb, _resetStmts, run, get, DB_PATH } from '../lib/pm/db';
import { scoreWallet, normalCdf } from '../lib/intel/wallet-score';
import { ensureSchema, antiLeaderboard, biasFingerprint, fadeScore, crowdOfLosers, fadeBacktest, emitFadeSignals } from '../lib/intel/fade';

const L = '0x1111111111111111111111111111111111111111'; // systematic loser
const G = '0x2222222222222222222222222222222222222222'; // lucky-but-fine wallet
const T0 = 1_780_000_000;
let seq = 0;
function trade(wallet: string, cid: string, oi: number, side: 'BUY' | 'SELL', size: number, price: number, ts: number, slug = 'ev') {
    run(`INSERT INTO trades(id, wallet, condition_id, outcome_index, outcome, side, size, price, usdc, ts, event_slug, market_slug, title, asset, tx_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `f${++seq}`, wallet, cid, oi, oi === 0 ? 'Yes' : 'No', side, size, price, size * price, ts, slug, slug, `Q ${cid}`, 'a', `tx${seq}`);
}
function market(cid: string, winner: number | null, category: string, endTs: number, slug = 'ev', yes = 0.5) {
    run(`INSERT INTO markets(condition_id, event_slug, question, outcomes, category, end_ts, resolved, winner_index, closed, active, yes_price, best_bid, best_ask, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        cid, slug, `Q ${cid}`, '["Yes","No"]', category, endTs, winner === null ? 0 : 1, winner, winner === null ? 0 : 1, winner === null ? 1 : 0, yes, yes - 0.01, yes + 0.01, T0);
}

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); ensureSchema(); });
test.after(() => { closeDb(); _resetStmts(); });

test('anti-leaderboard flags a wallet that buys 60¢ favourites and wins only 20%', () => {
    // 60 markets, each: L buys 100 @0.60 at day i, market ends day i+1. Wins 12/60 = 20% vs implied 60%.
    for (let i = 0; i < 60; i++) {
        const cid = `0xl${i}`; const win = i % 5 === 0; // 12 wins
        market(cid, win ? 0 : 1, 'sports', T0 + (i + 1) * 86_400, `nfl-x-${i}`);
        trade(L, cid, 0, 'BUY', 100, 0.60, T0 + i * 86_400, `nfl-x-${i}`);
    }
    scoreWallet(L);
    const rows = antiLeaderboard({ minResolved: 50, maxLossP: 0.05 });
    assert.equal(rows.length, 1); assert.equal(rows[0].wallet, L);
    // pnl = 12*40 - 48*60 = 480 - 2880 = -2400 ; staked 3600 ; roi -0.6667
    assert.ok(Math.abs(rows[0].pnl + 2400) < 1e-6); assert.ok(Math.abs(rows[0].roi + 2400 / 3600) < 1e-9);
    // z = (12 - 36)/sqrt(60*0.24) = -24/3.7947 = -6.32 -> loss_p ~ 0
    assert.ok(rows[0].loss_p < 1e-6);
    // calibrated: risk = 3600 * sqrt(0.4/0.6) = 2939.4 -> -2400/2939.4 = -0.8165
    assert.ok(Math.abs(rows[0].calibrated_roi + 2400 / (3600 * Math.sqrt(0.4 / 0.6))) < 1e-6);
});

test('bias fingerprint: longshot buyer, chaser, one-sided, fan money', () => {
    // G: buys 10 longshots at 0.10 that all lose, chases (buys higher than own earlier buy), always index 0, all in one event.
    for (let i = 0; i < 10; i++) {
        const cid = `0xg${i}`; market(cid, 1, 'politics', T0 + (i + 1) * 86_400, 'one-event');
        trade(G, cid, 0, 'BUY', 100, 0.10, T0 + i * 86_400, 'one-event');
        trade(G, cid, 0, 'BUY', 100, 0.15, T0 + i * 86_400 + 1800, 'one-event'); // chase +5pp
    }
    scoreWallet(G);
    const fp = biasFingerprint(G);
    assert.equal(fp.n_resolved, 10);
    assert.equal(fp.longshot_share, 1); assert.equal(fp.longshot_roi, -1);
    assert.ok(Math.abs(fp.chaser_score! - 0.05) < 1e-9); assert.equal(fp.chaser_n, 10);
    assert.equal(fp.one_sided_share, 1); assert.equal(fp.top_event_share, 1); assert.equal(fp.top_category, 'politics');
    assert.ok(fp.tags.indexOf('longshot_buyer') >= 0 && fp.tags.indexOf('fan_money') >= 0 && fp.tags.indexOf('one_sided_idx0') >= 0);
    assert.ok(fp.tags.indexOf('chaser') < 0, 'chaser needs >= 20 observations');
    assert.ok(get('SELECT 1 FROM wallet_bias WHERE wallet = ?', G));
});

test('fade score, crowd of losers, fade signals', () => {
    const nowTs = Math.floor(Date.now() / 1000);
    market('0xopen', null, 'sports', nowTs + 86_400, 'nfl-open', 0.50);
    trade(L, '0xopen', 0, 'BUY', 100, 0.70, nowTs - 600, 'nfl-open'); // overpays 20pp vs fair 0.50
    trade(G, '0xopen', 1, 'BUY', 100, 0.50, nowTs - 500, 'nfl-open');
    const f = fadeScore({ wallet: L, condition_id: '0xopen', outcome_index: 0, price: 0.70 });
    assert.equal(f.category, 'sports'); assert.ok(f.badness > 0.8 && f.significance > 0.99);
    assert.ok(Math.abs(f.distance - 0.8) < 1e-9, 'distance = (0.70-0.50)/0.25');
    assert.ok(f.score >= 80, `score ${f.score}`);
    const g = fadeScore({ wallet: G, condition_id: '0xopen', outcome_index: 1, price: 0.5 });
    assert.ok(g.score > 0 && g.score < 50, `G is bad but has only 10 resolved -> halved score, got ${g.score}`);
    assert.equal(fadeScore({ wallet: '0x9999999999999999999999999999999999999999', condition_id: '0xopen', outcome_index: 1, price: 0.5 }).score, 0, 'unknown wallet is not faded');
    const c = crowdOfLosers('0xopen', 7, { minResolved: 50, maxLossP: 0.05 });
    const yes = c.sides.find(s => s.outcome_index === 0)!; assert.equal(yes.loser_share, 1);
    const no = c.sides.find(s => s.outcome_index === 1)!; assert.equal(no.loser_share, 0);
    const n = emitFadeSignals(24, { minResolved: 50, maxLossP: 0.05, minScore: 40 });
    assert.equal(n, 1);
    const sig = get<{ outcome_index: number; wallet: string }>('SELECT outcome_index, wallet FROM signals WHERE type = ?', 'fade')!;
    assert.equal(sig.outcome_index, 1, 'fade signal points at the opposite side'); assert.equal(sig.wallet, L);
});

test('fade backtest is walk-forward: first 50 resolved positions are never faded', () => {
    const r = fadeBacktest({ minResolved: 50, maxLossP: 0.05, feeBps: 0, slippageBps: 0, wallets: [L] });
    // L has 60 positions. Entry of position i is at day i, it resolves at day i+1. Resolved strictly BEFORE entry i:
    // positions j with j+1 < i -> j <= i-2 -> (i-1) positions. Flag needs 50 -> i >= 51 -> positions 51..59 = 9 fades.
    assert.equal(r.n, 9); assert.equal(r.flaggedWallets, 1);
    // L wins at i%5==0 -> only i=55 in 51..59, so fades win 8 of 9. Fade buys NO at 0.40 with stake 60 (L's cost): win +60*(1/0.4-1)=+90, loss -60.
    assert.equal(r.wins, 8); assert.ok(Math.abs(r.pnl - (8 * 90 - 1 * 60)) < 1e-6);
    assert.ok(Math.abs(r.staked - 540) < 1e-6); assert.ok(Math.abs(r.roi! - 660 / 540) < 1e-9);
    const rs = fadeBacktest({ minResolved: 50, maxLossP: 0.05, feeBps: 100, slippageBps: 500, wallets: [L] });
    assert.ok(rs.pnl < r.pnl, 'fees and slippage reduce pnl');
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
});

test('real DB (if populated): anti-leaderboard runs and numbers are internally consistent', () => {
    closeDb(); _resetStmts();
    if (!fs.existsSync(DB_PATH)) { console.log('skip: no real DB'); openDb(':memory:'); return; }
    openDb(DB_PATH); ensureSchema();
    const w = get<{ n: number }>('SELECT COUNT(*) n FROM wallets WHERE trade_count > 0')!.n;
    const r = get<{ n: number }>('SELECT COUNT(*) n FROM markets WHERE resolved = 1')!.n;
    const s = get<{ n: number }>('SELECT COUNT(*) n FROM wallet_scores')!.n;
    if (w < 5 || r < 100 || s === 0) { console.log(`skip: real DB wallets=${w} resolved=${r} scores=${s}`); closeDb(); _resetStmts(); openDb(':memory:'); return; }
    const rows = antiLeaderboard({ minResolved: 50, maxLossP: 0.1, limit: 5 });
    for (const x of rows) { assert.ok(x.calibrated_roi < 0 && x.loss_p <= 0.1 && x.wins <= x.n_resolved); }
    console.log(`real anti-leaderboard: ${rows.length} rows; worst ${rows[0]?.wallet.slice(0, 10)} cal=${rows[0]?.calibrated_roi.toFixed(3)} n=${rows[0]?.n_resolved}`);
    closeDb(); _resetStmts(); openDb(':memory:');
});
