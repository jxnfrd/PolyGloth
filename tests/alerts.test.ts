import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts, run, all } from '../lib/pm/db';
import { ensureSchema, seedDefaults, createRule, evaluate, matches, ruleFromForm, listAlerts, deliver } from '../lib/alerts/alerts';

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); ensureSchema(); });
test.after(() => { closeDb(); _resetStmts(); });

const T = 1_800_000_000;
function seed() {
    run(`INSERT INTO markets(condition_id, question, category, yes_price, is_sports, event_slug) VALUES ('0xa','Will X happen?','politics',0.42,0,'x'),('0xb','Spread: Rams','sports',0.5,1,'nfl-x'),('0xc','Fed cut?','economy',0.30,0,'fed')`);
    run(`INSERT INTO wallets(address, username) VALUES ('0xw1','sharp'),('0xw2','dull')`);
    run(`INSERT INTO wallet_scores(wallet, category, window_days, n_resolved, calibrated_roi, p_value) VALUES ('0xw1','all',0,120,0.35,0.02),('0xw2','all',0,80,-0.2,0.6)`);
    run(`INSERT INTO signals(id, type, ts, wallet, condition_id, outcome_index, score, payload) VALUES
        (1,'consensus',${T},NULL,'0xa',0,75,'{"wallets":["0xw1","0xw3","0xw4"],"usdc":12000}'),
        (2,'comment_spike',${T + 1800},NULL,'0xa',NULL,80,'{"z":4.1}'),
        (3,'consensus',${T},NULL,'0xb',0,50,'{"wallets":["0xw1","0xw3"],"usdc":5000}'),
        (4,'insider',${T + 60},'0xw2','0xc',1,8,'{"reasons":["fresh_big"],"usdc":3000}'),
        (5,'insider',${T + 120},'0xw2','0xb',1,9,'{"reasons":["fresh_big"],"usdc":3000}'),
        (6,'arb_multi_outcome',${T + 200},NULL,NULL,NULL,12,'{"event_slug":"fed","edge":0.012}'),
        (7,'arb_ladder',${T + 200},NULL,'0xc',NULL,2,'{"spread":0.004}'),
        (8,'early_resolution',${T + 300},NULL,'0xa',0,60,'{"gapCents":12}'),
        (9,'fade',${T + 400},'0xw1','0xa',1,55,'{"usdc":900}')`);
}

test('default rules match the right synthetic signals (and nothing else)', () => {
    seed();
    assert.equal(seedDefaults(), 4);
    assert.equal(seedDefaults(), 0, 'seeding is idempotent');
    const created = evaluate(T - 10);
    const byRule = new Map<number, number[]>();
    for (const a of created) byRule.set(a.rule_id, [...(byRule.get(a.rule_id) ?? []), ...a.signal_ids]);
    assert.deepEqual(byRule.get(1), [1], 'consensus: politics market only, sports excluded');
    assert.deepEqual(byRule.get(2), [4], 'insider ≥7: economy market only, sports excluded');
    assert.deepEqual(byRule.get(3), [6], 'arb ≥1%: multi-outcome 1.2% yes, ladder 0.4% no');
    assert.deepEqual(byRule.get(4), [8], 'early resolution gap 12¢ ≥ 5');
    assert.equal(evaluate(T - 10).length, 0, 'second evaluation dedupes per rule/market/outcome/day');
});

test('requireAll combo: consensus + comment_spike within 60 min on the same market', () => {
    const id = createRule('combo', { signalTypes: ['consensus'], requireAll: [{ signalType: 'comment_spike', withinMinutes: 60 }] });
    const created = evaluate(T - 10).filter(a => a.rule_id === id);
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].signal_ids, [1, 2]);
    assert.match(created[0].summary, /\+ comment_spike/);
    const tight = createRule('combo-tight', { signalTypes: ['consensus'], requireAll: [{ signalType: 'comment_spike', withinMinutes: 10 }] });
    assert.equal(evaluate(T - 10).filter(a => a.rule_id === tight).length, 0, '30 min gap fails a 10 min window');
});

test('wallet thresholds, price bounds, usdc, categories', () => {
    const sharpFade = createRule('fade by sharp wallets', { signalTypes: ['fade'], walletMinCalibratedRoi: 0.2, walletMaxPValue: 0.05, walletMinResolved: 100, priceMin: 0.3, priceMax: 0.6, minUsdc: 500, categories: ['politics'] });
    assert.deepEqual(evaluate(T - 10).filter(a => a.rule_id === sharpFade).flatMap(a => a.signal_ids), [9]);
    const dull = createRule('insider by dull', { signalTypes: ['insider'], walletMinCalibratedRoi: 0 });
    assert.equal(evaluate(T - 10).filter(a => a.rule_id === dull).length, 0, 'wallet 0xw2 has negative calibrated ROI');
    const sig = { id: 99, type: 'consensus', ts: T, wallet: null, condition_id: '0xa', outcome_index: 0, score: 10, payload: '{"wallets":["a"]}', question: null, category: 'politics', yes_price: 0.42, is_sports: 0, calibrated_roi: null, p_value: null, n_resolved: null };
    assert.equal(matches({ minWallets: 2 }, sig), false);
    assert.equal(matches({ minWallets: 1, minScore: 10 }, sig), true);
    assert.equal(matches({ minScore: 11 }, sig), false);
});

test('form parsing and delivery without Telegram config', async () => {
    const r = ruleFromForm({ signalTypes: ['consensus', 'insider'], minScore: '7', categories: 'politics', excludeSports: 'on', requireType: 'comment_spike', requireWithinMinutes: '45', priceMax: '' });
    assert.deepEqual(r, { signalTypes: ['consensus', 'insider'], categories: ['politics'], minScore: 7, excludeSports: true, requireAll: [{ signalType: 'comment_spike', withinMinutes: 45 }] });
    delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID;
    const printed: string[] = [];
    const d = await deliver({ print: m => printed.push(m) });
    assert.equal(d.configured, false); assert.equal(d.sent, 0); assert.ok(d.pending >= 4 && printed.length === d.pending);
    assert.ok(listAlerts(5).every(a => a.delivered === 0));
    assert.ok(all('SELECT id FROM alerts').length >= 4);
});
