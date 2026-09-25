import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts, run, now, all } from '../lib/pm/db';
import { disputeRisk, headlineGap, lineDiff, clarificationAlerts, resolutionHistory, earlyResolutionScan, seedSourceWatch, ensureSchema } from '../lib/market/resolution';

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); ensureSchema(); });
test.after(() => { closeDb(); _resetStmts(); });

test('dispute risk scoring', () => {
    const clean = disputeRisk({ description: 'This market resolves to Yes if the U.S. Bureau of Labor Statistics reports a CPI print above 3.0% for September 2026, per https://www.bls.gov/cpi/ released on October 14, 2026 at 8:30 AM ET. Otherwise it resolves No.', resolution_source: 'https://www.bls.gov/cpi/', question: 'CPI above 3.0% for September?' });
    assert.ok(clean.score <= 10, `clean score ${clean.score}: ${clean.reasons.join(', ')}`);
    const messy = disputeRisk({ description: 'Resolves based on a consensus of credible reporting. Resolution is at the sole discretion of the market creator. Unless otherwise stated this may resolve 50/50.', resolution_source: '', question: 'Will X happen by June?' });
    assert.ok(messy.score >= 70, `messy score ${messy.score}`);
    assert.ok(messy.reasons.some(r => /discretion/.test(r)) && messy.reasons.some(r => /credible/.test(r)) && messy.reasons.some(r => /50\/50/.test(r)));
    assert.equal(disputeRisk({ description: '' }).score, 60);
});

test('headline gap heuristics', () => {
    const g = headlineGap('Will Bitcoin hit $150k by December 31?', 'This market resolves Yes if the announced closing price on Binance is at or above 140,000 USDT.');
    assert.ok(g.flags.some(f => /150000/.test(f)), g.flags.join(' | '));
    assert.ok(g.flags.some(f => /month "dec"/.test(f)));
    assert.ok(g.flags.some(f => /announcement/.test(f)));
    assert.equal(g.flags.length, 4, g.flags.join(' | '));
    assert.ok(g.flags.some(f => /cut-off time/.test(f)));
    assert.equal(headlineGap('Will it rain in London on October 3?', 'Resolves Yes if the Met Office reports rain in London on October 3, 2026 by 11:59 PM GMT.').flags.length, 0);
});

test('clarification diff from rules_changed signals', () => {
    const before = 'Resolves Yes if X occurs. Source: CNN. Deadline is June 30.';
    const after = 'Resolves Yes if X occurs. Source: Reuters or AP. Deadline is June 30.';
    const d = lineDiff(before, after);
    assert.deepEqual(d.removed, ['Source: CNN.']); assert.deepEqual(d.added, ['Source: Reuters or AP.']);
    run('INSERT INTO signals(type, ts, condition_id, score, payload) VALUES (?,?,?,?,?)', 'rules_changed', now(), '0xr', 50, JSON.stringify({ before, after, question: 'Will X occur?' }));
    const alerts = clarificationAlerts();
    assert.equal(alerts.length, 1); assert.equal(alerts[0].diff.added[0], 'Source: Reuters or AP.');
});

test('resolution history + early-resolution scan + source watch seeding', async () => {
    const t = now();
    const ins = (cid: string, q: string, w: number | null, resolved: number, yes: number, end: number, src = '') =>
        run('INSERT INTO markets(condition_id, question, description, outcomes, category, yes_price, best_bid, best_ask, end_ts, closed, resolved, winner_index, resolution_source, uma_status, volume24hr, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', cid, q, 'rules text long enough to not be flagged as short. Source https://example.org official page.', '["Yes","No"]', 'politics', yes, yes - 0.005, yes + 0.005, end, resolved, resolved, w, src, '', 1000, t);
    ins('0x1', 'Will A happen by March 2026?', 1, 1, 0.01, t - 86400);
    ins('0x2', 'Will B happen by April 2026?', 0, 1, 0.99, t - 86400);
    ins('0x3', 'Will C happen by May 2026?', 1, 1, 0.01, t - 86400);
    ins('0x4', 'Will D be above 5%?', 0, 1, 0.99, t - 86400);
    const h = resolutionHistory({ pattern: 'by_date' });
    const all_ = h.find(x => x.category === 'all')!;
    assert.equal(all_.n, 3); assert.ok(Math.abs(all_.yesShare - 1 / 3) < 1e-9);
    // early resolution: resolved YES (winner 0) but price still 0.90 → gap 10¢
    ins('0x5', 'Will E happen?', 0, 1, 0.90, t - 3600);
    const er = await earlyResolutionScan(10);
    assert.equal(er.length, 1); assert.equal(er[0].condition_id, '0x5'); assert.equal(er[0].gapCents, 10); assert.equal(er[0].winnerOutcome, 'Yes');
    assert.equal(all('SELECT * FROM signals WHERE type = ?', 'early_resolution').length, 1);
    // source watch
    run('INSERT INTO markets(condition_id, question, description, outcomes, resolution_source, closed, resolved, volume24hr, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', '0x6', 'Q', 'd', '["Yes","No"]', 'https://www.bls.gov/cpi/', 0, 0, 5, t);
    assert.equal(seedSourceWatch(), 1);
});
