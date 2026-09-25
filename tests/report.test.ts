import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, closeDb, _resetStmts, run, get } from '../lib/pm/db';
import { ensureSchema, sync, scoreTags, attribution, portfolio, taxCsv, autoTags, referencePrice, addManualEntry, entries } from '../lib/report/journal';
import { build, toMarkdown } from '../lib/report/edge-report';

test.before(() => { closeDb(); _resetStmts(); openDb(':memory:'); ensureSchema(); });
test.after(() => { closeDb(); _resetStmts(); });

const NOW = 1_800_000_000;
function seed() {
    run(`INSERT INTO markets(condition_id, question, category, yes_price, event_slug, clob_token_ids, resolved, winner_index) VALUES
        ('0xa','Will A?','politics',0.70,'ev-a','["tokA0","tokA1"]',1,0),
        ('0xb','Will B?','crypto',0.10,'ev-b','["tokB0","tokB1"]',1,1),
        ('0xc','Will C?','politics',0.55,'ev-a','["tokC0","tokC1"]',0,NULL)`);
    run(`INSERT INTO prices(token_id, ts, price) VALUES ('tokA0',${NOW - 100},0.80),('tokB0',${NOW - 100},0.05)`);
    // copy order: leader @0.50, filled 0.52, 100 shares → resolved YES: pnl = 100 - 52 = 48
    run(`INSERT INTO paper_orders(id, strategy, ts, wallet, condition_id, outcome_index, side, price, size, usd, reason, status, close_price, close_ts, pnl) VALUES
        (1,'copy',${NOW - 5 * 86400},'0xw','0xa',0,'BUY',0.52,100,52,'copy Will A | leader @0.50 $1000','resolved',1,${NOW - 86400},48),
        (2,'near_certainty',${NOW - 4 * 86400},NULL,'0xb',0,'BUY',0.20,200,40,'harvest','resolved',0,${NOW - 86400},-40),
        (3,'copy',${NOW - 3600},'0xw',  '0xc',0,'BUY',0.50,100,50,'copy Will C | leader @0.49 $500','open',NULL,NULL,NULL),
        (4,'copy',${NOW - 3600},'0xw',  '0xc',0,'BUY',0.99,0,0,'price_moved | leader','rejected',NULL,NULL,NULL)`);
    run(`INSERT INTO signals(type, ts, condition_id, outcome_index, score, payload, outcome) VALUES
        ('consensus',${NOW - 5 * 86400 + 600},'0xa',0,75,'{"wallets":["a","b"],"usdc":5000}','WIN'),
        ('consensus',${NOW - 12 * 86400},'0xb',0,60,'{"wallets":["a","b"],"usdc":3000}','LOSS'),
        ('insider',${NOW - 2 * 86400},'0xc',0,8,'{"usdc":2000}',NULL),
        ('comment_spike',${NOW - 86400},'0xc',NULL,80,'{"z":4.2}',NULL),
        ('arb_multi_outcome',${NOW - 3 * 86400},NULL,NULL,20,'{"event_slug":"ev-a","edge":0.02}',NULL)`);
    for (let i = 0; i < 6; i++) run(`INSERT INTO signals(type, ts, condition_id, outcome_index, score, payload, outcome) VALUES ('fade',${NOW - 10 * 86400 - i},'0xa',1,50,'{}','WIN')`);
    for (let i = 0; i < 6; i++) run(`INSERT INTO signals(type, ts, condition_id, outcome_index, score, payload, outcome) VALUES ('fade',${NOW - 2 * 86400 - i},'0xa',1,50,'{}',${i < 2 ? "'WIN'" : "'LOSS'"})`);
    run(`INSERT INTO wallets(address, username) VALUES ('0xflip','flipper')`);
    run(`INSERT INTO wallet_scores(wallet, category, window_days, n_resolved, calibrated_roi) VALUES ('0xflip','all',30,15,-0.1),('0xflip','all',90,40,0.2)`);
}

test('journal sync + auto tags + tag scoring', () => {
    seed();
    const s = sync();
    assert.deepEqual(s, { created: 3, updated: 0 }, 'rejected orders are not journaled');
    assert.deepEqual(sync(), { created: 0, updated: 0 });
    const e = entries(10).find(x => x.paper_order_id === 1)!;
    assert.deepEqual(e.reasons, ['copy Will A', 'leader @0.50 $1000']);
    assert.deepEqual(e.tags, ['cat:politics', 'midrange', 'signal:consensus', 'strategy:copy', 'venue:polymarket', 'whale_copy']);
    assert.equal(e.outcome, 'WIN'); assert.equal(e.pnl, 48);
    assert.deepEqual(autoTags({ strategy: 'kalshi:arb', condition_id: 'x', price: 0.05, ts: 0 }, 'economy', []), ['arb', 'cat:economy', 'longshot', 'strategy:kalshi:arb', 'venue:kalshi']);
    const tags = scoreTags();
    const copy = tags.find(t => t.tag === 'whale_copy')!;
    assert.equal(copy.n, 2); assert.equal(copy.resolved, 1); assert.equal(copy.wins, 1); assert.equal(copy.pnl, 48); assert.ok(Math.abs(copy.roi! - 48 / 52) < 1e-9);
    const nc = tags.find(t => t.tag === 'near_certainty')!;
    assert.equal(nc.pnl, -40); assert.equal(nc.hitRate, 0);
    addManualEntry({ condition_id: '0xc', outcome_index: 1, side: 'BUY', price: 0.45, usd: 90, note: 'gut call', tags: ['gut'] });
    assert.ok(entries(10).some(x => x.note === 'gut call' && x.tags.includes('manual')));
});

test('attribution sums exactly to realized P/L; hand-checked numbers', () => {
    const a = attribution(0);
    const copy = a.byStrategy.find(x => x.strategy === 'copy')!;
    // order 1: ref 0.50, fill 0.52, close 0.80 (prices table), 100 shares, realized 48
    // skill = (0.80-0.50)*100 = 30 ; slippage = -(0.52-0.50)*100 = -2 ; fees 0 ; luck = 48-30+2 = 20 = (1.00-0.80)*100
    assert.equal(copy.n, 1); assert.equal(copy.realized, 48);
    assert.ok(Math.abs(copy.skill - 30) < 1e-9); assert.ok(Math.abs(copy.slippage + 2) < 1e-9); assert.equal(copy.fees, 0); assert.ok(Math.abs(copy.luck - 20) < 1e-9);
    const nc = a.byStrategy.find(x => x.strategy === 'near_certainty')!;
    // order 2: ref = fill 0.20, close 0.05, 200 shares, realized -40: skill = (0.05-0.20)*200 = -30, slippage 0, luck = -40+30 = -10
    assert.ok(Math.abs(nc.skill + 30) < 1e-9); assert.equal(nc.slippage, 0); assert.ok(Math.abs(nc.luck + 10) < 1e-9);
    for (const x of [...a.byStrategy, a.total]) assert.ok(Math.abs(x.realized - (x.skill + x.slippage + x.fees + x.luck)) < 1e-9, `${x.strategy} sums to realized`);
    const withFees = attribution(100); // 1% of notional
    const c2 = withFees.byStrategy.find(x => x.strategy === 'copy')!;
    assert.ok(Math.abs(c2.fees + 0.52) < 1e-9); assert.ok(Math.abs(c2.luck - 20.52) < 1e-9, 'fees reduce luck residual by the same amount so the identity holds');
    assert.equal(referencePrice('copy X | leader @0.57 $100', 0.6), 0.57); assert.equal(referencePrice('harvest', 0.6), 0.6);
});

test('portfolio marks open positions and groups by category/event; tax CSV', () => {
    const p = portfolio();
    assert.equal(p.totals.n, 1);
    const l = p.lines[0];
    assert.equal(l.condition_id, '0xc'); assert.equal(l.mark, 0.55); assert.ok(Math.abs(l.value! - 55) < 1e-9); assert.ok(Math.abs(l.unrealized! - 5) < 1e-9);
    assert.equal(p.byCategory[0].category, 'politics'); assert.equal(p.byEvent[0].event_slug, 'ev-a');
    assert.match(p.kalshiNote, /No Kalshi/);
    const csv = taxCsv('US'); const lines = csv.trim().split('\n');
    assert.equal(lines.length, 3, 'header + 2 closed orders');
    assert.equal(lines[0].split(',')[0], 'open_date');
    assert.match(lines[1], /^\d{2}\/\d{2}\/\d{4},/);
    assert.ok(lines[1].includes(',100.0000,0.5200,52.00,100.00,48.00,'), 'qty, entry, cost, proceeds, pnl');
    assert.match(taxCsv('ISO').split('\n')[1], /^\d{4}-\d{2}-\d{2},/);
});

test('edge report on synthetic two-week data', () => {
    const r = build(NOW, 7);
    const fade = r.signals.find(s => s.type === 'fade')!;
    assert.equal(fade.n, 6); assert.equal(fade.nPrev, 6);
    assert.ok(Math.abs(fade.hitRate! - 2 / 6) < 1e-9); assert.equal(fade.hitRatePrev, 1);
    assert.equal(fade.decayed, true, '100% → 33% with ≥5 resolved each side');
    assert.deepEqual(r.decayed.map(s => s.type), ['fade']);
    const cons = r.signals.find(s => s.type === 'consensus')!;
    assert.equal(cons.n, 1); assert.equal(cons.nPrev, 1); assert.equal(cons.decayed, false, 'too few resolved to call decay');
    assert.equal(r.walletsFlipped.length, 1); assert.equal(r.walletsFlipped[0].direction, 'fading');
    assert.equal(r.consensusTop.length, 1); assert.equal(r.consensusTop[0].wallets, 2);
    assert.equal(r.arb.n, 1); assert.equal(r.arb.bestEdge, 0.02); assert.equal(r.arb.bestType, 'arb_multi_outcome');
    const copy = r.paper.find(p => p.strategy === 'copy')!;
    assert.equal(copy.pnl, 48);
    assert.equal(r.insider.flags, 1); assert.equal(r.insider.hitRate, null);
    assert.equal(r.commentSpikes.length, 1); assert.equal(r.commentSpikes[0].z, 4.2);
    const md = toMarkdown(r);
    assert.match(md, /\| fade \| 6 \| 6 \| 6 \| 33% \| 100% \| \*\*yes\*\* \|/);
    assert.match(md, /flipper: 20\.0% → -10\.0% \(fading\)/);
    assert.ok(get('SELECT 1 FROM paper_orders WHERE id = 4'), 'rejected order untouched');
});
