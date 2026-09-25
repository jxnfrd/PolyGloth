import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { openDb, closeDb, _resetStmts, run, now } from '../lib/pm/db';
import { TOOL_DEFS, callTool, whalesInCategoryTodayTool, arbOpportunitiesTool } from '../lib/ops/mcp-tools';

const T = 1_800_000_000;
test.before(() => {
    closeDb(); _resetStmts(); openDb(':memory:');
    const t = now();
    // Two wallets: A is sharp (roi>0, p<0.1), B is not significant. Both traded an economy market and a sports market today.
    run(`INSERT INTO wallets(address, username, trade_count) VALUES ('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','sharpA',3), ('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','dullB',2)`);
    run(`INSERT INTO wallet_scores(wallet, category, window_days, n_markets, n_resolved, wins, staked, pnl, roi, calibrated_roi, p_value, computed_at) VALUES
         ('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','all',0,50,45,30,10000,2500,0.25,0.31,0.02,${T}),
         ('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','all',0,40,35,18,8000,100,0.0125,0.01,0.45,${T})`);
    run(`INSERT INTO events(id, slug, title, tags, category, neg_risk, updated_at) VALUES ('1','fed-decision','Fed decision','["Fed"]','economy',1,${T})`);
    run(`INSERT INTO markets(condition_id, event_id, event_slug, question, outcomes, category, yes_price, best_bid, best_ask, volume24hr, resolved, closed, active, updated_at) VALUES
         ('0x${'1'.repeat(64)}','1','fed-decision','Will the Fed cut 25bps in October?','["Yes","No"]','economy',0.6,0.59,0.61,50000,0,0,1,${T}),
         ('0x${'2'.repeat(64)}','2','nfl-x-y','Spread: X (-3.5)','["X","Y"]','sports',0.5,0.49,0.51,90000,0,0,1,${T})`);
    const ins = (id: string, w: string, cid: string, side: string, usdc: number, price: number, ts: number) =>
        run(`INSERT INTO trades(id, wallet, condition_id, outcome_index, outcome, side, size, price, usdc, ts, event_slug, title) VALUES (?,?,?,0,'Yes',?,?,?,?,?,'x','q')`, id, w, cid, side, usdc / price, price, usdc, ts);
    ins('t1', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0x' + '1'.repeat(64), 'BUY', 5000, 0.6, t - 3600);
    ins('t2', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0x' + '1'.repeat(64), 'SELL', 1000, 0.62, t - 1800);
    ins('t3', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0x' + '2'.repeat(64), 'BUY', 7000, 0.5, t - 600);
    ins('t4', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '0x' + '1'.repeat(64), 'BUY', 9000, 0.6, t - 900);
    ins('t5', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0x' + '1'.repeat(64), 'BUY', 50, 0.6, t - 100); // below minUsdc
    ins('t6', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0x' + '1'.repeat(64), 'BUY', 4000, 0.6, t - 30 * 3600); // yesterday
    run(`INSERT INTO signals(type, ts, condition_id, outcome_index, score, payload) VALUES ('arb_ladder', ${T}, '0x${'1'.repeat(64)}', 0, 10, '{"spread":0.02}'), ('arb_ladder', ${T - 1}, '0x${'1'.repeat(64)}', 0, 2, '{"spread":0.002}'), ('arb_multi_outcome', ${T}, NULL, NULL, 30, '{"edge":0.03,"event_slug":"fed-decision"}')`);
});
test.after(() => { closeDb(); _resetStmts(); });

test('tool definitions are well-formed', () => {
    assert.equal(TOOL_DEFS.length, 8);
    for (const t of TOOL_DEFS) { assert.match(t.name, /^[a-z_]+$/); assert.ok(t.description.length > 20); assert.equal(t.inputSchema.type, 'object'); }
});

test('whales_in_category_today: only sharp wallets, only the category, only the window, sides summed', () => {
    const r = whalesInCategoryTodayTool({ category: 'economy', hours: 24, minResolved: 30, maxPValue: 0.1, minUsdc: 100 });
    assert.equal(r.length, 1, 'dullB (p=0.45) excluded');
    assert.equal(r[0].wallet, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(r[0].buys_usdc, 5000, 'the $50 trade is under minUsdc and the $4000 one is 30h old; sports trade excluded');
    assert.equal(r[0].sells_usdc, 1000);
    assert.equal(r[0].markets.length, 2);
    assert.equal(whalesInCategoryTodayTool({ category: 'sports' })[0].buys_usdc, 7000);
    assert.equal(whalesInCategoryTodayTool({ category: 'all', hours: 48 })[0].buys_usdc, 16000, 'all categories, 48h window includes the 30h-old trade');
});

test('arb_opportunities (stored) groups by type and applies minEdge', async () => {
    const r = await arbOpportunitiesTool({ minEdge: 0.01 });
    assert.equal(r.live, false);
    const ladder = r.groups.find(g => g.type === 'arb_ladder')!; const multi = r.groups.find(g => g.type === 'arb_multi_outcome')!;
    assert.equal(ladder.n, 1, 'the 0.2% spread ladder is filtered out');
    assert.equal(multi.n, 1);
    assert.equal(r.groups.find(g => g.type === 'arb_cross_venue')!.n, 0);
});

test('callTool dispatch + validation', async () => {
    const s = await callTool('db_stats') as { stats: Record<string, number> };
    assert.equal(s.stats.trades, 6);
    const w = await callTool('wallet_report', { address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', trades: 2 }) as { wallet: Record<string, unknown>; trades: unknown[] };
    assert.equal(w.wallet.username, 'sharpA'); assert.equal(w.trades.length, 2);
    await assert.rejects(callTool('wallet_report', { address: 'nope' }), /proxy wallet/);
    await assert.rejects(callTool('market_detail', { conditionId: '0x12' }), /conditionId/);
    const m = await callTool('market_detail', { conditionId: '0x' + '1'.repeat(64) }) as { market: Record<string, unknown>; holders: unknown[] };
    assert.equal(m.market.category, 'economy'); assert.ok(m.holders.length >= 1);
    const ms = await callTool('search_markets', { q: 'Fed', category: 'economy' }) as unknown[];
    assert.equal(ms.length, 1);
    await assert.rejects(callTool('no_such_tool'), /unknown tool/);
});

test('stdio server: initialize, tools/list, tools/call over JSON-RPC', async () => {
    const child = spawn('npx', ['tsx', path.resolve('scripts/pm-mcp.ts')], { cwd: process.cwd(), env: { ...process.env, POLYGLOTH_DB: ':memory:' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines: string[] = []; let buf = '';
    child.stdout.on('data', (b: Buffer) => { buf += b.toString(); const parts = buf.split('\n'); buf = parts.pop() ?? ''; lines.push(...parts.filter(Boolean)); });
    const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + '\n');
    const waitFor = (n: number, ms = 60_000) => new Promise<void>((res, rej) => { const t0 = Date.now(); const iv = setInterval(() => { if (lines.length >= n) { clearInterval(iv); res(); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`timeout waiting for ${n} lines; got ${lines.length}: ${lines.join(' | ').slice(0, 300)}`)); } }, 50); });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
    await waitFor(1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'db_stats', arguments: {} } });
    send({ jsonrpc: '2.0', id: 4, method: 'nope' });
    await waitFor(4);
    child.stdin.end();
    const msgs = lines.map(l => JSON.parse(l));
    const init = msgs.find(m => m.id === 1); assert.equal(init.result.serverInfo.name, 'polygloth'); assert.ok(init.result.capabilities.tools);
    const list = msgs.find(m => m.id === 2); assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name).sort(), TOOL_DEFS.map(t => t.name).sort());
    const call = msgs.find(m => m.id === 3); assert.equal(call.result.isError, false); assert.ok(JSON.parse(call.result.content[0].text).stats);
    const err = msgs.find(m => m.id === 4); assert.equal(err.error.code, -32601);
    await new Promise(r => child.on('close', r));
});
