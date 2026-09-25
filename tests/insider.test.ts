import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts, run, get, all } from '../lib/pm/db';
import { ensureSchema, detectInMarket, persistFlags, ledger, priceImpact, walletAge, WalletAge } from '../lib/intel/insider';
import { leaderboard } from '../lib/pm/data-api';

const T0 = 1_790_000_000;
let seq = 0;
type Row = { id: string; wallet: string; condition_id: string; outcome_index: number; side: string; price: number; usdc: number; ts: number; title: string };
function row(wallet: string, oi: number, usdc: number, ts: number, price = 0.5, side = 'BUY'): Row { return { id: `i${++seq}`, wallet, condition_id: '0xmkt', outcome_index: oi, side, price, usdc, ts, title: 'Q' }; }
const age = (firstTs: number | null, n: number, complete = true): WalletAge => ({ address: '', firstTs, nTradesSeen: n, complete });

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); ensureSchema(); });
test.after(() => { closeDb(); _resetStmts(); });

test('detector: fresh+big, niche, sniper cluster, one-and-done, improbable record; scoring capped at 10', () => {
    const mkt = { condition_id: '0xmkt', question: 'Q', volume24hr: 40_000 }; // niche market (< 50k)
    const tape: Row[] = [
        row('0xfresh', 0, 1500, T0 + 100),           // wallet 2h old with 12 trades, $1.5k -> fresh_big (1500/40000 = 3.75% < 5% -> no niche)
        row('0xold', 0, 5000, T0 + 200),             // old wallet, 12.5% of vol -> niche only
        row('0xa', 1, 600, T0 + 1000), row('0xb', 1, 700, T0 + 1200), row('0xc', 1, 800, T0 + 1500), // sniper cluster of 3 within 500s
        row('0xa', 1, 100, T0 + 1600),               // below cluster min -> not part of cluster, no reasons
        row('0xone', 0, 200, T0 + 3000),             // 1 trade ever -> one_and_done
        row('0xsharp', 0, 300, T0 + 4000),           // improbable record via scores
        row('0xnoise', 0, 50, T0 + 5000),            // nothing
        row('0xsell', 0, 9000, T0 + 6000, 0.5, 'SELL') // sells ignored
    ];
    const ages: Record<string, WalletAge> = { '0xfresh': age(T0 + 100 - 7200, 12), '0xold': age(T0 - 400 * 86_400, 900, false), '0xone': age(T0 + 3000, 1), '0xa': age(T0 - 86_400 * 30, 50), '0xb': age(T0 - 86_400 * 30, 50), '0xc': age(T0 - 86_400 * 30, 50) };
    const scores = { '0xsharp': { p_value: 0.01, n_resolved: 40 }, '0xa': { p_value: 0.5, n_resolved: 40 } };
    const flags = detectInMarket(tape, mkt, ages, scores);
    const by: Record<string, typeof flags[0]> = {}; for (const f of flags) by[f.wallet] = f;
    assert.deepEqual(by['0xfresh'].reasons, ['fresh_big']); assert.equal(by['0xfresh'].score, 4); assert.ok(Math.abs(by['0xfresh'].wallet_age_h! - 2) < 1e-9);
    assert.deepEqual(by['0xold'].reasons, ['niche']); assert.equal(by['0xold'].score, 2);
    assert.deepEqual(by['0xa'].reasons, ['sniper']); assert.equal(by['0xa'].cluster_wallets, 3);
    assert.deepEqual(by['0xb'].reasons, ['sniper']); assert.deepEqual(by['0xc'].reasons, ['sniper']);
    assert.deepEqual(by['0xone'].reasons, ['one_and_done']);
    assert.deepEqual(by['0xsharp'].reasons, ['improbable_record']); assert.equal(by['0xsharp'].score, 3);
    assert.ok(!by['0xnoise'] && !by['0xsell']);
    assert.equal(flags.filter(f => f.wallet === '0xa').length, 1, 'the small $100 follow-up is not flagged');
    // cap: fresh + niche + one_and_done + improbable + sniper = 13 -> 10
    const big = detectInMarket([row('0xz', 0, 5000, T0 + 100), row('0xy', 0, 600, T0 + 150), row('0xx', 0, 600, T0 + 200)], mkt, { '0xz': age(T0, 1) }, { '0xz': { p_value: 0.001, n_resolved: 50 } });
    assert.equal(big.find(f => f.wallet === '0xz')!.score, 10);
    // near-certainty buys are never flagged; incomplete history gives unknown age (null), never negative
    const nc = detectInMarket([row('0xq', 0, 5000, T0 + 100, 0.998), row('0xr', 0, 600, T0 + 150, 0.998), row('0xs', 0, 600, T0 + 200, 0.998), row('0xbig', 0, 5000, T0 + 300, 0.5)], mkt, { '0xq': age(T0, 1), '0xbig': age(T0 + 1000, 500, false) }, {});
    assert.equal(nc.length, 1); assert.equal(nc[0].wallet, '0xbig'); assert.deepEqual(nc[0].reasons, ['niche']); assert.equal(nc[0].wallet_age_h, null);
});

test('persist, ledger, price impact', () => {
    run(`INSERT INTO markets(condition_id, question, outcomes, category, yes_price, resolved, winner_index, updated_at) VALUES (?,?,?,?,?,?,?,?)`, '0xmkt', 'Q', '["Yes","No"]', 'politics', 0.7, 0, null, T0);
    const flags = detectInMarket([row('0xfresh', 0, 1500, T0 + 100, 0.5)], { condition_id: '0xmkt', question: 'Q', volume24hr: 1e6 }, { '0xfresh': age(T0, 2) }, {});
    assert.equal(persistFlags(flags), 1); assert.equal(persistFlags(flags), 0, 'idempotent');
    const s = get<{ id: number }>('SELECT id FROM signals WHERE type = ?', 'insider')!;
    const pi = priceImpact(s.id)!; assert.ok(Math.abs(pi.moved_pp - 20) < 1e-9, 'price moved from 0.50 to 0.70');
    let led = ledger(); assert.equal(led[0].reason, 'fresh_big'); assert.equal(led[0].resolved, 0);
    run('UPDATE signals SET outcome = ?, resolved_ts = ? WHERE id = ?', 'WIN', T0 + 999, s.id);
    led = ledger(); assert.equal(led[0].hit_rate, 1);
    assert.equal(all('SELECT * FROM insider_flags').length, 1);
});

test('walletAge (live): a leaderboard wallet is old and not one-and-done', async () => {
    const lb = await leaderboard('all', 'vol', 1);
    const a = await walletAge(lb[0].proxyWallet);
    assert.equal(a.nTradesSeen, 500); assert.equal(a.complete, false);
    const again = await walletAge(lb[0].proxyWallet); assert.equal(again.nTradesSeen, 500, 'cached');
});
