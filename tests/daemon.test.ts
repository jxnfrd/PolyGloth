import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts } from '../lib/pm/db';
import { dueJobs, secondsUntilNext, runJob, loop, readState, writeState, JOBS, JobName, JobState, describeSchedule } from '../lib/ops/daemon';

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); });
test.after(() => { closeDb(); _resetStmts(); });

const fresh = (over: Partial<Record<JobName, Partial<JobState>>> = {}): Record<JobName, JobState> => {
    const out = {} as Record<JobName, JobState>;
    for (const j of JOBS) out[j.name] = { lastRun: 0, lastOk: true, lastDurationSec: 0, runs: 0, ...(over[j.name] ?? {}) };
    return out;
};

test('schedule math: never-run jobs are due, chain only when triggered, priority ordering', () => {
    const at = 1_800_000_000;
    const due = dueJobs(fresh(), at);
    assert.deepEqual(due.map(j => j.name), ['refresh', 'kalshi', 'prices', 'books', 'alerts'], 'chain excluded until triggered');
    const s = fresh({ refresh: { lastRun: at - 100 }, kalshi: { lastRun: at - 100 }, prices: { lastRun: at - 100 }, books: { lastRun: at - 100 }, alerts: { lastRun: at - 100 }, chain: { pendingTrigger: true } });
    assert.deepEqual(dueJobs(s, at).map(j => j.name), ['chain'], 'only the triggered chain is due');
    const s2 = fresh({ refresh: { lastRun: at - 6 * 3600 + 1 }, kalshi: { lastRun: at - 6 * 3600 - 1 }, prices: { lastRun: at }, books: { lastRun: at - 3600 }, alerts: { lastRun: at - 14 * 60 } });
    assert.deepEqual(dueJobs(s2, at).map(j => j.name), ['kalshi', 'books'], 'refresh 1s early, kalshi 1s late, books exactly at interval, alerts 1 min early');
});

test('schedule math: seconds until next', () => {
    const at = 1_800_000_000;
    const s = fresh({ refresh: { lastRun: at - 3600 }, kalshi: { lastRun: at - 3600 }, prices: { lastRun: at - 3600 }, books: { lastRun: at - 3000 }, alerts: { lastRun: at - 600 } });
    assert.equal(secondsUntilNext(s, at), 300, 'alerts due in 300 s is the soonest');
    assert.equal(secondsUntilNext(fresh({ chain: { pendingTrigger: true } }), at), 0);
});

test('runJob persists state, marks failures, and refresh triggers chain', async () => {
    const logs: string[] = [];
    const bodies = { refresh: async () => 'ok', chain: async () => 'ok', books: async () => { throw new Error('boom'); }, prices: async () => 'ok', kalshi: async () => 'ok', alerts: async () => 'ok' };
    const r = await runJob('refresh', m => logs.push(m), bodies);
    assert.ok(r.lastOk && r.runs === 1);
    assert.equal(readState('chain').pendingTrigger, true, 'refresh sets the chain trigger');
    const c = await runJob('chain', m => logs.push(m), bodies);
    assert.ok(c.lastOk && readState('chain').pendingTrigger === false);
    const b = await runJob('books', m => logs.push(m), bodies);
    assert.equal(b.lastOk, false); assert.match(b.lastError ?? '', /boom/);
    assert.ok(logs.some(l => l.includes('✗ books')));
    assert.match(describeSchedule(), /books\s+every 60 min\s+last 0 min ago \(FAILED/);
});

test('loop runs due jobs sequentially and stops', async () => {
    for (const j of JOBS) writeState(j.name, { lastRun: 1_800_000_000, lastOk: true, lastDurationSec: 0, runs: 0 }); // nothing due (far future lastRun irrelevant: we set alerts due)
    writeState('alerts', { lastRun: 0, lastOk: true, lastDurationSec: 0, runs: 0 });
    const ran: string[] = []; let ticks = 0;
    const bodies = { refresh: async () => 'r', chain: async () => 'c', books: async () => 'b', prices: async () => 'p', kalshi: async () => 'k', alerts: async () => { ran.push('alerts'); return 'a'; } };
    await loop({ log: () => {}, bodies, shouldStop: () => ++ticks > 3, sleep: async () => {} });
    assert.deepEqual(ran, ['alerts'], 'alerts ran exactly once, then the loop slept and stopped');
});
