import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { openDb, kvGet, kvSet, all, now } from '../pm/db';

/**
 * Single-process sequential scheduler. SQLite has one writer, so jobs never overlap:
 * the loop picks the most overdue job, runs it to completion, persists last-run in `kv`, repeats.
 *
 * Jobs (intervals in seconds):
 *   refresh  6h   refreshAll() from lib/pm/ingest (events, leaderboards, wallet trades, resolutions, positions)
 *   chain    -    after every successful refresh: `bash scripts/pm-run-all.sh 8000` (score → fade → insider → arb → …)
 *   books    1h   order-book snapshots for the top N two-sided markets by 24h volume
 *   prices   24h  hourly price history for tokens of markets that ingested wallets traded
 *   kalshi   6h   open Kalshi markets (events endpoint)
 *   alerts   15m  lib/alerts/alerts.ts evaluate+deliver when that module exists
 */

export type JobName = 'refresh' | 'chain' | 'books' | 'prices' | 'kalshi' | 'alerts';

export interface JobSpec {
    name: JobName;
    intervalSec: number;
    /** Jobs run in this order when several are due at once (lower first). */
    priority: number;
    /** 'chain' is triggered by refresh, not by its own interval. */
    triggeredBy?: JobName;
}

export const JOBS: JobSpec[] = [
    { name: 'refresh', intervalSec: 6 * 3600, priority: 1 },
    { name: 'chain', intervalSec: Number.MAX_SAFE_INTEGER, priority: 2, triggeredBy: 'refresh' },
    { name: 'kalshi', intervalSec: 6 * 3600, priority: 3 },
    { name: 'prices', intervalSec: 24 * 3600, priority: 4 },
    { name: 'books', intervalSec: 3600, priority: 5 },
    { name: 'alerts', intervalSec: 15 * 60, priority: 6 }
];

export interface JobState { lastRun: number; lastOk: boolean; lastDurationSec: number; runs: number; lastError?: string; pendingTrigger?: boolean }

const KV_PREFIX = 'daemon:job:';

export function readState(name: JobName): JobState {
    return kvGet<JobState>(KV_PREFIX + name) ?? { lastRun: 0, lastOk: true, lastDurationSec: 0, runs: 0 };
}
export function writeState(name: JobName, s: JobState) { kvSet(KV_PREFIX + name, s); }

/** Pure schedule math: which jobs are due at `at`, ordered by priority then overdue-ness. */
export function dueJobs(states: Record<JobName, JobState>, at: number, jobs: JobSpec[] = JOBS): JobSpec[] {
    return jobs
        .filter(j => {
            const s = states[j.name];
            if (j.triggeredBy) return Boolean(s?.pendingTrigger);
            return !s || at - s.lastRun >= j.intervalSec;
        })
        .sort((a, b) => a.priority - b.priority || (at - (states[a.name]?.lastRun ?? 0)) - (at - (states[b.name]?.lastRun ?? 0)));
}

/** Seconds until the next interval job is due (for sleeping). */
export function secondsUntilNext(states: Record<JobName, JobState>, at: number, jobs: JobSpec[] = JOBS): number {
    let best = 3600;
    for (const j of jobs) {
        if (j.triggeredBy) { if (states[j.name]?.pendingTrigger) return 0; continue; }
        const s = states[j.name];
        const wait = s ? s.lastRun + j.intervalSec - at : 0;
        best = Math.min(best, Math.max(0, wait));
    }
    return best;
}

export function loadStates(): Record<JobName, JobState> {
    openDb();
    const out = {} as Record<JobName, JobState>;
    for (const j of JOBS) out[j.name] = readState(j.name);
    return out;
}

export type Logger = (msg: string) => void;
const ts = () => new Date().toISOString().slice(11, 19);
export const defaultLog: Logger = m => console.log(`[${ts()}] ${m}`);

// ---------------------------------------------------------------------------
// Job bodies (network + DB writes). Each returns a short summary string.
// ---------------------------------------------------------------------------

async function jobRefresh(log: Logger): Promise<string> {
    const ingest = await import('../pm/ingest');
    await ingest.refreshAll({ walletsToIngest: Number(process.env.DAEMON_WALLETS || 60), maxTradesPerWallet: 3000, resolutions: 4000, log });
    return JSON.stringify(ingest.dbStats());
}

function jobChain(log: Logger, limit = Number(process.env.DAEMON_CHAIN_RESOLUTIONS || 8000)): Promise<string> {
    return new Promise((resolve, reject) => {
        const script = path.resolve(process.cwd(), 'scripts', 'pm-run-all.sh');
        const child = spawn('bash', [script, String(limit)], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        let tail = '';
        const onData = (b: Buffer) => { const s = b.toString(); tail = (tail + s).slice(-4000); for (const line of s.split('\n')) if (/^=====/.test(line)) log(`chain ${line.replace(/=/g, '').trim()}`); };
        child.stdout.on('data', onData); child.stderr.on('data', onData);
        child.on('error', reject);
        child.on('close', code => (code === 0 ? resolve(`chain exit 0; tail: ${tail.split('\n').slice(-3).join(' | ')}`) : reject(new Error(`chain exit ${code}: ${tail.slice(-500)}`))));
    });
}

async function jobBooks(log: Logger, n = Number(process.env.DAEMON_BOOKS || 30)): Promise<string> {
    // Prefer the market-intelligence helper when present (it also picks two-sided books); fall back to the ingest primitive.
    try {
        const micro = await import('../market/microstructure');
        if (typeof micro.snapshotTopMarkets === 'function') { const k = await micro.snapshotTopMarkets(n); return `snapshotTopMarkets: ${k}`; }
    } catch (e) { log(`books: microstructure unavailable (${(e as Error).message}); using ingest.snapshotBook`); }
    const { snapshotBook } = await import('../pm/ingest');
    const rows = all<{ clob_token_ids: string }>(`SELECT clob_token_ids FROM markets WHERE resolved = 0 AND closed = 0 AND best_bid IS NOT NULL AND best_ask IS NOT NULL ORDER BY volume24hr DESC LIMIT ?`, n);
    let k = 0;
    for (const r of rows) {
        let tokens: string[] = [];
        try { tokens = JSON.parse(r.clob_token_ids || '[]'); } catch { /* skip */ }
        if (!tokens[0]) continue;
        try { await snapshotBook(tokens[0]); k++; } catch (e) { log(`books: ${tokens[0].slice(0, 12)} ${(e as Error).message}`); }
    }
    return `snapshotBook: ${k}/${rows.length}`;
}

async function jobPrices(log: Logger, limit = Number(process.env.DAEMON_PRICES || 400)): Promise<string> {
    const { ingestPrices } = await import('../pm/ingest');
    // Tokens of markets that ingested wallets traded, most recently traded first; skip 5-minute scalp markets.
    const rows = all<{ clob_token_ids: string; event_slug: string }>(
        `SELECT m.clob_token_ids, m.event_slug FROM markets m
          WHERE EXISTS (SELECT 1 FROM trades t WHERE t.condition_id = m.condition_id) AND m.clob_token_ids IS NOT NULL
          ORDER BY (SELECT MAX(ts) FROM trades t WHERE t.condition_id = m.condition_id) DESC LIMIT ?`, limit);
    let k = 0, pts = 0;
    for (const r of rows) {
        if (/updown|up-or-down/i.test(r.event_slug || '')) continue;
        let tokens: string[] = [];
        try { tokens = JSON.parse(r.clob_token_ids || '[]'); } catch { /* skip */ }
        if (!tokens[0]) continue;
        try { pts += await ingestPrices(tokens[0], '1d', 60); k++; } catch (e) { log(`prices: ${tokens[0].slice(0, 12)} ${(e as Error).message}`); }
    }
    return `prices: ${k} tokens, ${pts} points`;
}

async function jobKalshi(log: Logger): Promise<string> {
    const { ingestKalshi } = await import('../pm/ingest');
    const n = await ingestKalshi(log);
    return `kalshi: ${n} markets`;
}

async function jobAlerts(log: Logger): Promise<string> {
    // lib/alerts/alerts.ts is written by another builder; degrade gracefully when absent or shaped differently.
    let mod: Record<string, unknown>;
    try { mod = await import('../alerts/alerts' as string) as Record<string, unknown>; }
    catch { return 'alerts: module not present, skipped'; }
    const evaluate = mod.evaluate as ((sinceTs?: number) => Promise<unknown[]> | unknown[]) | undefined;
    const deliver = mod.deliver as (() => Promise<unknown> | unknown) | undefined;
    if (typeof evaluate !== 'function') return 'alerts: no evaluate() export, skipped';
    const since = now() - 20 * 60;
    const found = await evaluate(since);
    let delivered: unknown = 'n/a';
    if (typeof deliver === 'function') { try { delivered = await deliver(); } catch (e) { log(`alerts deliver: ${(e as Error).message}`); } }
    return `alerts: ${Array.isArray(found) ? found.length : '?'} new, deliver=${typeof delivered === 'object' ? JSON.stringify(delivered).slice(0, 120) : String(delivered)}`;
}

export const JOB_BODIES: Record<JobName, (log: Logger) => Promise<string>> = {
    refresh: jobRefresh, chain: jobChain, books: jobBooks, prices: jobPrices, kalshi: jobKalshi, alerts: jobAlerts
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runJob(name: JobName, log: Logger = defaultLog, bodies = JOB_BODIES): Promise<JobState> {
    openDb();
    const state = readState(name);
    const t0 = Date.now();
    log(`▶ ${name} start`);
    try {
        const summary = await bodies[name](log);
        const next: JobState = { lastRun: now(), lastOk: true, lastDurationSec: Math.round((Date.now() - t0) / 1000), runs: state.runs + 1, pendingTrigger: false };
        writeState(name, next);
        if (name === 'refresh') { const c = readState('chain'); writeState('chain', { ...c, pendingTrigger: true }); }
        log(`✓ ${name} ${next.lastDurationSec}s ${summary}`);
        return next;
    } catch (e) {
        const next: JobState = { lastRun: now(), lastOk: false, lastDurationSec: Math.round((Date.now() - t0) / 1000), runs: state.runs + 1, lastError: (e as Error).message.slice(0, 500), pendingTrigger: false };
        writeState(name, next);
        log(`✗ ${name} failed after ${next.lastDurationSec}s: ${next.lastError}`);
        return next;
    }
}

export interface LoopOptions { log?: Logger; pollSec?: number; shouldStop?: () => boolean; bodies?: Record<JobName, (log: Logger) => Promise<string>>; sleep?: (ms: number) => Promise<void> }

/** Main loop: run every due job (one at a time), then sleep until the next one. */
export async function loop(o: LoopOptions = {}): Promise<void> {
    const log = o.log ?? defaultLog; const pollSec = o.pollSec ?? 60; const sleep = o.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
    openDb();
    log(`daemon up · db ${process.env.POLYGLOTH_DB || 'data/polygloth.sqlite'} · jobs ${JOBS.map(j => j.name).join(', ')}`);
    while (!(o.shouldStop?.() ?? false)) {
        const states = loadStates();
        const due = dueJobs(states, now());
        if (due.length) { await runJob(due[0].name, log, o.bodies); continue; }
        const wait = Math.min(pollSec, Math.max(5, secondsUntilNext(states, now())));
        await sleep(wait * 1000);
    }
    log('daemon stopped');
}

export function describeSchedule(states: Record<JobName, JobState> = loadStates(), at = now()): string {
    const lines = JOBS.map(j => {
        const s = states[j.name];
        const every = j.triggeredBy ? `after ${j.triggeredBy}` : `every ${Math.round(j.intervalSec / 60)} min`;
        const last = s?.lastRun ? `${Math.round((at - s.lastRun) / 60)} min ago (${s.lastOk ? 'ok' : 'FAILED'}, ${s.lastDurationSec}s, ${s.runs} runs)` : 'never';
        const dueIn = j.triggeredBy ? (s?.pendingTrigger ? 'pending' : 'idle') : `${Math.max(0, Math.round(((s?.lastRun ?? 0) + j.intervalSec - at) / 60))} min`;
        return `${j.name.padEnd(8)} ${every.padEnd(18)} last ${last.padEnd(44)} due in ${dueIn}${s?.lastError ? `  err: ${s.lastError.slice(0, 80)}` : ''}`;
    });
    return lines.join('\n');
}
