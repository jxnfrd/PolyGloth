import { createHash } from 'node:crypto';
import { openDb, stmt, transaction, now, toTs, all, get, run } from './db';
import { getEventBySlug, listEvents, listComments, GammaEvent, GammaMarket } from './gamma';
import { leaderboard, walletTrades, marketTrades, walletPositions, Trade, LbWindow, LbOrder } from './data-api';
import { clobMarket, orderBook, priceHistory, depthWithin } from './clob';
import { allOpenKalshiMarkets } from './kalshi';
import { categorize } from './categories';

export type Logger = (msg: string) => void;
const quiet: Logger = () => {};

// ---------------------------------------------------------------------------
// Events + markets
// ---------------------------------------------------------------------------

export function upsertEvent(ev: GammaEvent) {
    openDb();
    const cat = categorize(ev.tags, ev.slug, ev.title);
    transaction(() => {
        stmt(`INSERT INTO events(id, slug, title, tags, category, neg_risk, comment_count, volume, volume24hr, liquidity, open_interest, end_ts, active, closed, resolution_source, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, title=excluded.title, tags=excluded.tags, category=excluded.category, neg_risk=excluded.neg_risk,
                comment_count=excluded.comment_count, volume=excluded.volume, volume24hr=excluded.volume24hr, liquidity=excluded.liquidity, open_interest=excluded.open_interest,
                end_ts=excluded.end_ts, active=excluded.active, closed=excluded.closed, resolution_source=excluded.resolution_source, updated_at=excluded.updated_at`)
            .run(ev.id, ev.slug, ev.title, JSON.stringify(ev.tags), cat, ev.negRisk ? 1 : 0, ev.commentCount, ev.volume, ev.volume24hr, ev.liquidity, ev.openInterest, toTs(ev.endDate), ev.active ? 1 : 0, ev.closed ? 1 : 0, ev.resolutionSource, now());
        for (const m of ev.markets) upsertMarket(m, cat);
    });
}

export function upsertMarket(m: GammaMarket, category?: string) {
    if (!m.conditionId) return;
    const cat = category ?? categorize(m.tags, m.eventSlug || m.slug, m.question);
    const descHash = createHash('sha1').update(m.description).digest('hex').slice(0, 16);
    const prev = get<{ description_hash: string; description: string }>('SELECT description_hash, description FROM markets WHERE condition_id = ?', m.conditionId);
    if (prev && prev.description_hash && prev.description_hash !== descHash) {
        // Rules changed: record it (resolution.ts turns this into a clarification alert).
        run('INSERT INTO signals(type, ts, condition_id, score, payload) VALUES (?,?,?,?,?)', 'rules_changed', now(), m.conditionId, 50, JSON.stringify({ before: prev.description.slice(0, 2000), after: m.description.slice(0, 2000), question: m.question }));
    }
    stmt(`INSERT INTO markets(condition_id, gamma_id, event_id, event_slug, market_slug, question, description, outcomes, clob_token_ids, category, neg_risk, is_sports,
            volume, volume24hr, liquidity, yes_price, best_bid, best_ask, spread, start_ts, end_ts, active, closed, resolution_source, uma_status, description_hash, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(condition_id) DO UPDATE SET gamma_id=excluded.gamma_id, event_id=COALESCE(NULLIF(excluded.event_id,''), markets.event_id), event_slug=COALESCE(NULLIF(excluded.event_slug,''), markets.event_slug),
            market_slug=excluded.market_slug, question=excluded.question, description=excluded.description, outcomes=excluded.outcomes, clob_token_ids=excluded.clob_token_ids,
            category=excluded.category, neg_risk=excluded.neg_risk, is_sports=excluded.is_sports, volume=excluded.volume, volume24hr=excluded.volume24hr, liquidity=excluded.liquidity,
            yes_price=excluded.yes_price, best_bid=excluded.best_bid, best_ask=excluded.best_ask, spread=excluded.spread, start_ts=excluded.start_ts, end_ts=excluded.end_ts,
            active=excluded.active, closed=excluded.closed, resolution_source=excluded.resolution_source, uma_status=excluded.uma_status, description_hash=excluded.description_hash, updated_at=excluded.updated_at`)
        .run(m.conditionId, m.id, m.eventId, m.eventSlug, m.slug, m.question, m.description, JSON.stringify(m.outcomes), JSON.stringify(m.clobTokenIds), cat, m.negRisk ? 1 : 0, m.isSports ? 1 : 0,
            m.volume, m.volume24hr, m.liquidity, m.outcomePrices[0] ?? null, m.bestBid || null, m.bestAsk || null, m.spread || null, toTs(m.startDate), toTs(m.endDate), m.active ? 1 : 0, m.closed ? 1 : 0, m.resolutionSource, m.umaResolutionStatus, descHash, now());
}

/** Fetch + store events for the given slugs, skipping ones refreshed within `maxAgeSec`. */
export async function ingestEventsBySlugs(slugs: string[], maxAgeSec = 6 * 3600, log: Logger = quiet): Promise<number> {
    openDb();
    const uniq = Array.from(new Set(slugs.filter(Boolean)));
    let n = 0;
    for (const slug of uniq) {
        const row = get<{ updated_at: number }>('SELECT updated_at FROM events WHERE slug = ?', slug);
        if (row && now() - row.updated_at < maxAgeSec) continue;
        try {
            const ev = await getEventBySlug(slug, 0);
            if (ev) { upsertEvent(ev); n++; }
            else run('INSERT OR IGNORE INTO events(id, slug, title, tags, category, updated_at) VALUES (?,?,?,?,?,?)', `missing:${slug}`, slug, '', '[]', 'other', now());
        } catch (e) { log(`event ${slug}: ${(e as Error).message}`); }
    }
    return n;
}

export async function ingestTopEvents(limit = 200, order: 'volume24hr' | 'volume' | 'commentCount' | 'liquidity' = 'volume24hr', log: Logger = quiet): Promise<number> {
    openDb();
    let n = 0;
    for (let offset = 0; offset < limit; offset += 50) {
        const evs = await listEvents({ limit: Math.min(50, limit - offset), offset, active: true, closed: false, order });
        for (const ev of evs) { upsertEvent(ev); n++; }
        if (evs.length < 50) break;
    }
    log(`events: ${n} upserted`);
    return n;
}

// ---------------------------------------------------------------------------
// Wallets + trades
// ---------------------------------------------------------------------------

export async function ingestLeaderboards(limit = 100, log: Logger = quiet): Promise<number> {
    openDb();
    let n = 0;
    const combos: [LbWindow, LbOrder][] = [['month', 'pnl'], ['month', 'vol'], ['all', 'vol'], ['all', 'pnl'], ['week', 'pnl']];
    for (const [window, orderBy] of combos) {
        for (let offset = 0; offset < limit; offset += 50) {
            const rows = await leaderboard(window, orderBy, Math.min(50, limit - offset), offset);
            transaction(() => {
                for (const r of rows) {
                    stmt(`INSERT INTO wallets(address, username, source) VALUES (?,?,'leaderboard')
                          ON CONFLICT(address) DO UPDATE SET username = COALESCE(NULLIF(excluded.username,''), wallets.username)`).run(r.proxyWallet, r.userName);
                    if (window === 'month' && orderBy === 'pnl') run('UPDATE wallets SET lb_rank_pnl_month=?, lb_pnl_month=?, lb_vol_month=? WHERE address=?', r.rank, r.pnl, r.vol, r.proxyWallet);
                    if (window === 'all' && orderBy === 'vol') run('UPDATE wallets SET lb_rank_vol_all=?, lb_pnl_all=?, lb_vol_all=? WHERE address=?', r.rank, r.pnl, r.vol, r.proxyWallet);
                    n++;
                }
            });
            if (rows.length < 50) break;
        }
    }
    log(`leaderboards: ${n} rows`);
    return n;
}

function tradeId(t: Trade): string { return `${t.txHash}:${t.asset}:${t.side}:${t.size}:${t.price}:${t.proxyWallet}`; }

export function insertTrades(trades: Trade[]): number {
    let inserted = 0;
    transaction(() => {
        const ins = stmt(`INSERT OR IGNORE INTO trades(id, wallet, condition_id, outcome_index, outcome, side, size, price, usdc, ts, event_slug, market_slug, title, asset, tx_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        for (const t of trades) {
            if (!t.conditionId || !t.proxyWallet) continue;
            const r = ins.run(tradeId(t), t.proxyWallet, t.conditionId, t.outcomeIndex, t.outcome, t.side, t.size, t.price, t.usdc, t.timestamp, t.eventSlug, t.marketSlug, t.title, t.asset, t.txHash);
            inserted += Number(r.changes);
        }
    });
    return inserted;
}

/** Pull a wallet's trade history into the DB and make sure its markets are known. */
export async function ingestWalletTrades(address: string, maxTrades = 3000, log: Logger = quiet): Promise<{ fetched: number; inserted: number }> {
    openDb();
    const wallet = address.toLowerCase();
    const trades = await walletTrades(wallet, maxTrades);
    const inserted = insertTrades(trades);
    const tsList = trades.map(t => t.timestamp);
    stmt(`INSERT INTO wallets(address, source, trades_ingested_at) VALUES (?, 'manual', ?)
          ON CONFLICT(address) DO UPDATE SET trades_ingested_at = excluded.trades_ingested_at`).run(wallet, now());
    run(`UPDATE wallets SET first_trade_ts = (SELECT MIN(ts) FROM trades WHERE wallet = ?), last_trade_ts = (SELECT MAX(ts) FROM trades WHERE wallet = ?),
         trade_count = (SELECT COUNT(*) FROM trades WHERE wallet = ?), trades_complete = ? WHERE address = ?`,
        wallet, wallet, wallet, trades.length < maxTrades ? 1 : 0, wallet);
    await ingestEventsBySlugs(Array.from(new Set(trades.map(t => t.eventSlug))), 12 * 3600, log);
    log(`wallet ${wallet.slice(0, 10)}: ${trades.length} trades fetched, ${inserted} new (oldest ${tsList.length ? new Date(Math.min(...tsList) * 1000).toISOString().slice(0, 10) : '-'})`);
    return { fetched: trades.length, inserted };
}

/** All trades in a market (every wallet). Seeds wallets seen there with source='market'. */
export async function ingestMarketTrades(conditionId: string, maxTrades = 3000, log: Logger = quiet): Promise<{ fetched: number; inserted: number; wallets: number }> {
    openDb();
    const trades = await marketTrades(conditionId.toLowerCase(), maxTrades);
    const inserted = insertTrades(trades);
    const wallets = new Set(trades.map(t => t.proxyWallet));
    transaction(() => { for (const w of Array.from(wallets)) stmt(`INSERT OR IGNORE INTO wallets(address, source) VALUES (?, 'market')`).run(w); });
    await ingestEventsBySlugs(Array.from(new Set(trades.map(t => t.eventSlug))), 12 * 3600, log);
    log(`market ${conditionId.slice(0, 10)}: ${trades.length} trades, ${inserted} new, ${wallets.size} wallets`);
    return { fetched: trades.length, inserted, wallets: wallets.size };
}

export async function snapshotPositions(address: string): Promise<number> {
    openDb();
    const pos = await walletPositions(address.toLowerCase());
    const ts = now();
    transaction(() => {
        const ins = stmt(`INSERT OR REPLACE INTO position_snapshots(wallet, condition_id, outcome_index, ts, size, avg_price, cur_price, initial_value, current_value, cash_pnl) VALUES (?,?,?,?,?,?,?,?,?,?)`);
        for (const p of pos) ins.run(p.proxyWallet, p.conditionId, p.outcomeIndex, ts, p.size, p.avgPrice, p.curPrice, p.initialValue, p.currentValue, p.cashPnl);
    });
    return pos.length;
}

// ---------------------------------------------------------------------------
// Resolutions
// ---------------------------------------------------------------------------

/** Check CLOB for winners on markets that are past end date or closed. Also records resolution on signals. */
export async function ingestResolutions(limit = 500, recheckAfterSec = 6 * 3600, log: Logger = quiet): Promise<{ checked: number; resolved: number }> {
    openDb();
    const t = now();
    // Markets that ingested wallets actually traded come first: those are the ones scoring needs.
    // Only markets someone in the store traded, or that hold a signal/paper order: the other ~400k event siblings never matter for scoring.
    const rows = all<{ condition_id: string }>(
        `SELECT m.condition_id FROM markets m
          WHERE m.resolved = 0 AND (m.closed = 1 OR (m.end_ts IS NOT NULL AND m.end_ts < ?))
            AND (m.resolution_checked_at IS NULL OR m.resolution_checked_at < ?)
            AND (EXISTS (SELECT 1 FROM trades t WHERE t.condition_id = m.condition_id)
                 OR EXISTS (SELECT 1 FROM signals s WHERE s.condition_id = m.condition_id)
                 OR EXISTS (SELECT 1 FROM paper_orders p WHERE p.condition_id = m.condition_id))
          ORDER BY m.end_ts DESC LIMIT ?`, t, t - recheckAfterSec, limit);
    let resolved = 0;
    for (const r of rows) {
        const m = await clobMarket(r.condition_id, 0);
        if (m && m.resolved) {
            run('UPDATE markets SET resolved = 1, winner_index = ?, closed = 1, resolution_checked_at = ? WHERE condition_id = ?', m.winnerIndex, t, r.condition_id);
            run(`UPDATE signals SET outcome = CASE WHEN outcome_index = ? THEN 'WIN' ELSE 'LOSS' END, resolved_ts = ? WHERE condition_id = ? AND outcome IS NULL AND outcome_index IS NOT NULL`, m.winnerIndex, t, r.condition_id);
            resolved++;
        } else {
            run('UPDATE markets SET resolution_checked_at = ? WHERE condition_id = ?', t, r.condition_id);
        }
    }
    log(`resolutions: ${rows.length} checked, ${resolved} resolved`);
    return { checked: rows.length, resolved };
}

/** Markets referenced by trades but unknown to the markets table (event lookup failed). */
export function unknownMarketIds(limit = 200): string[] {
    return all<{ condition_id: string }>(`SELECT DISTINCT t.condition_id FROM trades t LEFT JOIN markets m ON m.condition_id = t.condition_id WHERE m.condition_id IS NULL LIMIT ?`, limit).map(r => r.condition_id);
}

/** Fill unknown markets straight from CLOB (no tags → category from slug/title). */
export async function ingestUnknownMarketsFromClob(limit = 200, log: Logger = quiet): Promise<number> {
    let n = 0;
    for (const cid of unknownMarketIds(limit)) {
        const m = await clobMarket(cid, 0);
        if (!m) continue;
        const tr = get<{ event_slug: string; market_slug: string; title: string }>('SELECT event_slug, market_slug, title FROM trades WHERE condition_id = ? LIMIT 1', cid);
        const cat = categorize([], tr?.event_slug || '', tr?.title || m.question);
        stmt(`INSERT OR IGNORE INTO markets(condition_id, event_slug, market_slug, question, outcomes, clob_token_ids, category, neg_risk, end_ts, active, closed, winner_index, resolved, resolution_checked_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(cid, tr?.event_slug || '', tr?.market_slug || '', m.question, JSON.stringify(m.tokens.map(t => t.outcome)), JSON.stringify(m.tokens.map(t => t.tokenId)), cat, m.negRisk ? 1 : 0, toTs(m.endDateIso), m.active ? 1 : 0, m.closed ? 1 : 0, m.winnerIndex, m.resolved ? 1 : 0, now(), now());
        n++;
    }
    log(`clob fill: ${n} markets`);
    return n;
}

// ---------------------------------------------------------------------------
// Comments, books, prices, Kalshi
// ---------------------------------------------------------------------------

export async function ingestComments(eventId: string, max = 500, log: Logger = quiet): Promise<number> {
    openDb();
    let n = 0;
    for (let offset = 0; offset < max; offset += 100) {
        const cs = await listComments(eventId, 100, offset);
        if (!cs.length) break;
        transaction(() => {
            const ins = stmt(`INSERT OR IGNORE INTO comments(id, event_id, body, user_address, proxy_wallet, name, created_ts, reaction_count) VALUES (?,?,?,?,?,?,?,?)`);
            for (const c of cs) { n += Number(ins.run(c.id, c.eventId, c.body, c.userAddress, c.proxyWallet, c.name, toTs(c.createdAt), c.reactionCount).changes); if (c.proxyWallet) stmt(`INSERT OR IGNORE INTO wallets(address, username, source) VALUES (?,?,'comment')`).run(c.proxyWallet, c.name); }
        });
        if (cs.length < 100) break;
    }
    log(`comments event ${eventId}: ${n} new`);
    return n;
}

export async function snapshotBook(tokenId: string): Promise<void> {
    openDb();
    const b = await orderBook(tokenId);
    stmt(`INSERT OR REPLACE INTO book_snapshots(token_id, ts, best_bid, best_ask, mid, spread, depth_bid_1c, depth_ask_1c, depth_bid_5c, depth_ask_5c, bids, asks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(tokenId, b.fetchedAt, b.bestBid, b.bestAsk, b.mid, b.spread, depthWithin(b.bids, 'SELL', 1), depthWithin(b.asks, 'BUY', 1), depthWithin(b.bids, 'SELL', 5), depthWithin(b.asks, 'BUY', 5), JSON.stringify(b.bids.slice(0, 20)), JSON.stringify(b.asks.slice(0, 20)));
}

export async function ingestPrices(tokenId: string, interval: '1d' | '1w' | '1m' | 'max' = '1w', fidelity = 60): Promise<number> {
    openDb();
    const pts = await priceHistory(tokenId, interval, fidelity);
    transaction(() => { const ins = stmt('INSERT OR IGNORE INTO prices(token_id, ts, price) VALUES (?,?,?)'); for (const p of pts) ins.run(tokenId, p.t, p.p); });
    return pts.length;
}

export async function ingestKalshi(log: Logger = quiet): Promise<number> {
    openDb();
    const ms = await allOpenKalshiMarkets(400, log);
    transaction(() => {
        const ins = stmt(`INSERT INTO kalshi_markets(ticker, event_ticker, series_ticker, title, subtitle, status, yes_bid, yes_ask, no_bid, no_ask, last_price, volume, volume24h, open_interest, close_ts, rules, result, updated_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                          ON CONFLICT(ticker) DO UPDATE SET status=excluded.status, yes_bid=excluded.yes_bid, yes_ask=excluded.yes_ask, no_bid=excluded.no_bid, no_ask=excluded.no_ask, last_price=excluded.last_price,
                            volume=excluded.volume, volume24h=excluded.volume24h, open_interest=excluded.open_interest, close_ts=excluded.close_ts, result=excluded.result, updated_at=excluded.updated_at`);
        for (const m of ms) ins.run(m.ticker, m.eventTicker, m.seriesTicker, m.title, m.subtitle, m.status, m.yesBid, m.yesAsk, m.noBid, m.noAsk, m.lastPrice, m.volume, m.volume24h, m.openInterest, toTs(m.closeTime), m.rulesPrimary, m.result, now());
    });
    log(`kalshi: ${ms.length} open non-parlay markets`);
    return ms.length;
}

// ---------------------------------------------------------------------------
// Orchestrated refresh used by the CLI
// ---------------------------------------------------------------------------

export interface RefreshOptions { leaderboardLimit?: number; walletsToIngest?: number; maxTradesPerWallet?: number; topEvents?: number; resolutions?: number; positionSnapshots?: number; kalshi?: boolean; log?: Logger }

export async function refreshAll(o: RefreshOptions = {}): Promise<void> {
    const log = o.log ?? quiet;
    await ingestTopEvents(o.topEvents ?? 200, 'volume24hr', log);
    await ingestLeaderboards(o.leaderboardLimit ?? 100, log);
    // Wallets whose trades are stale (>12h) or never ingested, leaderboard first.
    const stale = all<{ address: string }>(
        `SELECT address FROM wallets WHERE source IN ('leaderboard','manual') AND (trades_ingested_at IS NULL OR trades_ingested_at < ?)
         ORDER BY CASE WHEN trades_ingested_at IS NULL THEN 0 ELSE 1 END, COALESCE(lb_rank_pnl_month, 9999), COALESCE(lb_rank_vol_all, 9999) LIMIT ?`,
        now() - 12 * 3600, o.walletsToIngest ?? 60);
    for (const w of stale) { try { await ingestWalletTrades(w.address, o.maxTradesPerWallet ?? 3000, log); } catch (e) { log(`wallet ${w.address}: ${(e as Error).message}`); } }
    await ingestUnknownMarketsFromClob(300, log);
    await ingestResolutions(o.resolutions ?? 4000, 6 * 3600, log);
    // Whale book: current open positions of the top leaderboard wallets (winners get redeemed, so this is a book, not a record).
    const whales = all<{ address: string }>('SELECT address FROM wallets WHERE lb_rank_pnl_month IS NOT NULL ORDER BY lb_rank_pnl_month LIMIT ?', o.positionSnapshots ?? 30);
    for (const w of whales) { try { const n = await snapshotPositions(w.address); log(`positions ${w.address.slice(0, 10)}: ${n}`); } catch (e) { log(`positions ${w.address}: ${(e as Error).message}`); } }
    if (o.kalshi !== false) { try { await ingestKalshi(log); } catch (e) { log(`kalshi: ${(e as Error).message}`); } }
}

export function dbStats(): Record<string, number> {
    openDb();
    const c = (t: string) => (get<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`)?.n ?? 0);
    return { wallets: c('wallets'), wallets_with_trades: get<{ n: number }>('SELECT COUNT(*) n FROM wallets WHERE trade_count > 0')?.n ?? 0, trades: c('trades'), markets: c('markets'), resolved_markets: get<{ n: number }>('SELECT COUNT(*) n FROM markets WHERE resolved = 1')?.n ?? 0, events: c('events'), comments: c('comments'), kalshi_markets: c('kalshi_markets'), signals: c('signals'), prices: c('prices') };
}
