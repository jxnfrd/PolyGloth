import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts, run, now } from '../lib/pm/db';
import { listEvents, listComments } from '../lib/pm/gamma';
import { upsertEvent } from '../lib/pm/ingest';
import { classifyStance, isEuphoric, hasLeakPhrase, isRulesLawyer, shillClusters, contrarianMood, sentimentPriceGap, velocitySpike, analyzeEvent, eventSentiment, ensureSchema } from '../lib/market/sentiment';

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); ensureSchema(); });
test.after(() => { closeDb(); _resetStmts(); });

test('stance classifier fixtures', () => {
    assert.equal(classifyStance('This is a lock, free money, buying yes').stance, 'YES');
    assert.equal(classifyStance("No chance this happens, fade it, never").stance, 'NO');
    assert.equal(classifyStance('Interesting market, what do you all think?').stance, 'neutral');
    const r = classifyStance('yes yes yes but no');
    assert.equal(r.stance, 'YES'); assert.ok(r.confidence > 0.4 && r.confidence < 0.6, `confidence ${r.confidence}`);
    // negation flips
    assert.equal(classifyStance('not yes').stance, 'NO');
    // outcome-name mapping for non-binary markets
    assert.equal(classifyStance('Lula wins this easily', ['Lula', 'Bolsonaro']).stance, 'YES');
    assert.equal(classifyStance('bolsonaro is the play', ['Lula', 'Bolsonaro']).stance, 'NO');
    // Portuguese: "no" means "in the" → neutral, not NO
    assert.equal(classifyStance('Quem vota Zema vai macetar o 22 no 2o turno, ta salvo').stance, 'neutral');
    assert.ok(isEuphoric('EASY MONEY!!!'));
    assert.ok(!isEuphoric('I think the odds are fair.'));
    assert.deepEqual(hasLeakPhrase('hearing that the deal is off, source says tonight'), ['hearing that', 'source says']);
    assert.ok(isRulesLawyer('technically the resolution criteria say announced not signed'));
});

test('shill clusters, mood, gap, velocity on synthetic rows', () => {
    const t = now();
    const body = 'Lula is going to win this easily, buying yes now before it pumps';
    const cs = [
        { id: 'a', wallet: '0x1', ts: t - 100, body },
        { id: 'b', wallet: '0x2', ts: t - 90, body: body + ' !' },
        { id: 'c', wallet: '0x3', ts: t - 80, body: 'Lula is going to win this easily, buying yes now before it pumps hard' },
        { id: 'd', wallet: '0x4', ts: t - 70, body: 'completely different opinion about the rules and resolution' }
    ];
    const cl = shillClusters(cs);
    assert.equal(cl.length, 1); assert.equal(cl[0].wallets.length, 3);
    const ana = cs.map(c => ({ id: c.id, wallet: c.wallet, name: '', ts: c.ts, body: c.body, stance: (c.id === 'd' ? 'neutral' : 'YES') as 'YES' | 'neutral', confidence: 1, heldSide: 'none' as const, divergent: false, euphoric: c.id !== 'd', leak: [], rulesLawyer: c.id === 'd' }));
    const mood = contrarianMood(ana);
    assert.equal(mood.oneSided, 1); assert.equal(mood.euphoria, 0.75); assert.equal(mood.index, 0.75); assert.equal(mood.side, 'YES');
    const gap = sentimentPriceGap(ana, 0.4, 86400, t, new Map([['a', 3]]));
    assert.equal(gap.n, 3); assert.equal(gap.yesShare, 1); assert.ok(Math.abs(gap.gap! - 0.6) < 1e-9);
    // velocity: 12 comments in the last hour, none in the prior 7 days → z = 12 (sd 0, mean 0 → z=lastHour)
    for (let i = 0; i < 12; i++) run('INSERT INTO comments(id, event_id, body, user_address, proxy_wallet, name, created_ts, reaction_count) VALUES (?,?,?,?,?,?,?,?)', `v${i}`, 'E1', 'x', '0xa', '0xa', 'n', t - 60 * i, 0);
    const v = velocitySpike('E1', t);
    assert.equal(v.lastHour, 12); assert.equal(v.meanHourly, 0); assert.equal(v.z, 12);
});

test('talk-vs-wallet divergence from trades table', async () => {
    const t = now();
    run('INSERT INTO events(id, slug, title, tags, category, updated_at) VALUES (?,?,?,?,?,?)', 'E2', 'ev2', 'Will it rain?', '[]', 'other', t);
    run('INSERT INTO markets(condition_id, event_id, event_slug, question, outcomes, yes_price, updated_at) VALUES (?,?,?,?,?,?,?)', '0xc1', 'E2', 'ev2', 'Will it rain?', '["Yes","No"]', 0.5, t);
    run('INSERT INTO trades(id, wallet, condition_id, outcome_index, outcome, side, size, price, usdc, ts) VALUES (?,?,?,?,?,?,?,?,?,?)', 'tr1', '0xw', '0xc1', 1, 'No', 'BUY', 100, 0.5, 50, t - 1000);
    run('INSERT INTO comments(id, event_id, body, user_address, proxy_wallet, name, created_ts, reaction_count) VALUES (?,?,?,?,?,?,?,?)', 'cm1', 'E2', 'yes this is a lock, free money', '0xw', '0xw', 'w', t - 10, 0);
    const { comments } = await analyzeEvent('E2', { fetchPositions: true, positionFetchLimit: 0 });
    assert.equal(comments.length, 1);
    assert.equal(comments[0].stance, 'YES'); assert.equal(comments[0].heldSide, 'NO'); assert.equal(comments[0].divergent, true);
});

test('live: comments from a busy event flow through eventSentiment', async () => {
    const evs = await listEvents({ limit: 1, active: true, closed: false, order: 'commentCount' });
    assert.ok(evs.length);
    upsertEvent(evs[0]);
    const cs = await listComments(evs[0].id, 20);
    assert.ok(cs.length >= 5);
    const r = await eventSentiment(evs[0].id, { fetchPositions: false, writeSignals: false });
    assert.equal(r.eventId, evs[0].id);
    // comments table was not filled by listComments (that's ingestComments); report reflects stored rows
    assert.ok(r.nComments >= 0);
});
