# PolyGloth — Handover (2026-09-25, v2 build)

Polymarket + Kalshi intelligence platform. Next.js 14 + Supabase (auth, legacy tables) + a local SQLite analytics store.
Local: `npm run dev` → http://localhost:3000/intel. Repo: github.com/jxnfrd/PolyGloth. **All of today's work is uncommitted.**

Read in this order: this file → `BUILD-PLAN.md` (what each module is) → `BACKTEST-2026-09-25.md` (why blind whale copying has no edge) → the module headers.

## 0. One paragraph

The January app was a demo: every dashboard signal was seeded, the whale scraper wrote placeholders, both LLM keys were dead, and the dashboard was public (details in §5). It was rebuilt in one day on Polymarket's free keyless APIs (Gamma, Data API, CLOB) and Kalshi's public API, with a local SQLite store (`data/polygloth.sqlite`, Node's built-in `node:sqlite`), 16 modules, 71 passing tests, an `/intel` dashboard (17 pages), a JSON API, an MCP server and a scheduler daemon. Everything is paper/analytics; nothing places orders. The old `/dashboard` still works and now shows real whale positions from the Data API.

## 1. Run it

```
npm run dev                                   # http://localhost:3000/intel (DASHBOARD_PUBLIC=true in .env.local skips login locally)
npx tsx scripts/pm-ingest.ts refresh 80 3000  # events, leaderboards, 80 wallets × 3000 trades, resolutions, Kalshi, whale positions (~1 h first time)
bash scripts/pm-run-all.sh                    # resolutions → kalshi → snapshots → score → fade → insider → arb → flow → sentiment → resolution → backtest → paper
npx tsx scripts/pm-daemon.ts --dry            # scheduler (refresh/chain/kalshi/prices/books/alerts); ops/com.polygloth.daemon.plist for launchd
npm test                                      # 74 tests, live APIs + in-memory DB, ~40 s
npx tsx scripts/pm-paper.ts poll              # paper-copies today's trades of the top scored wallets (default leaders = top by monthly P/L)
```
SQLite allows one writer at a time: never run two `pm-*` writers in parallel (readers, incl. the dashboard, are fine). `busy_timeout` is 15 s.

## 2. Layout

| Path | What |
|---|---|
| `lib/pm/` | Foundation. `http.ts` (per-host spacing, retries, TTL cache), `gamma.ts`, `data-api.ts`, `clob.ts`, `kalshi.ts` (events endpoint; `/markets?status=open` is parlays only), `categories.ts`, `db.ts` (schema), `ingest.ts` |
| `lib/intel/` | `wallet-score.ts` (calibrated ROI per category/window, Brier, p-value, edge trend, conviction, entry timing, lifecycle, hedge, consensus, divergence), `fade.ts` (anti-leaderboard, bias fingerprint, fade score, crowd-of-losers, walk-forward fade backtest), `insider.ts` (fresh+big, niche, sniper cluster, one-and-done, ledger, price-impact budget) |
| `lib/exec/` | `risk.ts` (Kelly, Kalshi fee, liquidity-adjusted size, haircuts, calibration/Brier, scenario P/L, breaker, tilt), `copy-paper.ts` (paper copy engine with offset/sizing/caps/exit mirroring/copy-lag/front-run/dumping/basket), `strategies.ts`, `backtest.ts` |
| `lib/market/` | `sentiment.ts` (comments ↔ wallets: stance, divergence, velocity, shills, mood, rules-lawyers), `microstructure.ts` (aggressor imbalance, iceberg clusters, depth map, spoof, thin-move, MM footprint, drift), `arb.ts` (multi-outcome, ladder, logical, cross-venue Kalshi with match report, lock-up return, rule diff), `resolution.ts` (early resolution, clarification diff, dispute risk, headline gap, source watch, base rates) |
| `lib/alerts/alerts.ts` | Alert composer: JSON rules (signal types, score, category, price, wallet thresholds, combined "A + B within N min"), dedupe, Telegram delivery when `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are set |
| `lib/report/journal.ts`, `edge-report.ts` | Trade journal with auto-tags ("which reasons pay"), attribution (skill / slippage / fees / luck, sums exactly to realized), paper portfolio, tax CSV; weekly edge report (7d vs prior 7d, decayed signals, edge flips) → `reports/edge-YYYY-MM-DD.md` |
| `lib/ops/daemon.ts`, `scripts/pm-daemon.ts`, `ops/*.plist` | Sequential scheduler: refresh 6 h → chain, Kalshi 6 h, prices daily, books hourly, alerts 15 min; launchd template |
| `lib/ops/api.ts`, `app/api/intel/*`, `docs/API.md` | JSON API (`{ok,data,generatedAt}`; `x-api-key` when `INTEL_API_KEY` is set): stats, wallets, wallet report, markets, market detail, signals, arb (`?live=1`) |
| `lib/ops/mcp-tools.ts`, `scripts/pm-mcp.ts`, `.mcp.json.example` | MCP server (stdio, hand-rolled JSON-RPC): `top_wallets`, `wallet_report`, `search_markets`, `market_detail`, `recent_signals`, `arb_opportunities`, `whales_in_category_today`, `db_stats`. Register: `claude mcp add polygloth -- npx tsx scripts/pm-mcp.ts` |
| `lib/ui/queries*.ts`, `app/intel/*`, `components/intel/ui.tsx` | Dashboard (all 200 on localhost, verified 2026-09-25): overview + signal ledger, wallets (sharpest / fade list), wallet detail, whale book, markets, market detail, signals, arb, flow (thin moves, spoofs, last-cents yield), sentiment, resolution (early gaps, rule changes, dispute risk), paper, journal, alerts, edge report, Kalshi |
| `scripts/pm-*.ts`, `scripts/pm-run-all.sh` | CLIs, one per module; usage line at the top of each |
| `tests/*.test.ts` | node:test; synthetic known-answer tests + live smoke tests |
| `lib/intelligence/*`, `app/dashboard` | Legacy news/AI/whale lanes from January, rebuilt but idle (need an LLM key; GDELT throttles this IP) |

## 3. Data facts that matter (learned the hard way)

- `/positions` shows only unredeemed holdings: winners vanish, losers stay at $0. Win rates must come from `/trades` + CLOB `tokens[].winner`.
- CLOB `prices-history` returns only ~30 trailing days per token; longer backtests need a daily price snapshot cron.
- Gamma `order=volume` sorts a string column; use `order=volume24hr` and `volume_num_min`. `?condition_ids=` returns nothing; look up by `events?slug=`.
- Kalshi `/markets?status=open` = auto-generated parlays (KXMVE*); use `/events?with_nested_markets=true`.
- Leaderboard whales are ~50/50 sports pickers on size: copy ROI +1.7 % (biased cohort) / −0.8 % (unbiased). See BACKTEST-2026-09-25.md.
- Gamma placeholder outcomes ("Will A win…", 50¢, no book) fake arbs; every arb leg requires a two-sided book and `active=1`.
- Comments carry `profile.proxyWallet`, so every commenter can be scored against their own trades.

## 3b. Bugs found on the first full run (2026-09-25 afternoon) and fixed
- Logical arb: the deadline regex swallowed "20" of "2027" as a day → "July 2027" parsed as July 20, 2026 and every Fed-cut ladder looked inverted (10 false signals). Regression test in `tests/arb.test.ts`.
- Ladder arb: 2,026 "violations" were Gamma placeholder markets quoting 2¢/98¢. Legs now need an active two-sided book with spread ≤ 20¢, and the spread is computed on executable prices (sell the rich leg at its bid, buy the cheap leg at its ask). Real result after the fix: 1 violation (Washington State win totals, 2¢).
- Cross-venue arb: Kalshi subtitles like "$81,000 or above" were unparsed, so every BTC strike matched → fake 96 % arbs. Threshold parser covers "or above/or below"; numbers must agree as whole tokens on both sides ("foldable iPhone" ≠ "iPhone 18", Sep 26 ≠ Sep 25). The remaining BTC pairs are same-strike, same-day, and the rule diff shows the 12:00 (Polymarket/Binance) vs 17:00 (Kalshi) resolution-time gap — that gap is the risk, not free money.
- Alert flood (3,287 alerts) was downstream of the above; alerts are regenerated after each fix.
- Whale copy backtest and fade backtest both land near zero or negative in sports; the wallet scores that survive p < 0.1 are the product.
- Turbopack produced `useContext of null` 500s twice after many edits (stale module cache). `npm run dev` now uses webpack (`npm run dev:turbo` keeps the old behaviour); if a 500 with that message ever appears, `rm -rf .next` and restart.
- QA: `qa/sweep.mjs` and `qa/interactions.mjs` (Playwright) cover every page and form; last clean run 2026-09-25, see `qa/README.md`.

## 4. Open items

1. **Apply `supabase/migrations/20260925_audit_v3.sql`** in the Supabase SQL editor (additive). Until then the legacy whale lane writes legacy columns only.
2. **LLM key** (`OPENAI_API_KEY` or `OPENROUTER_API_KEY` in `.env.local`) to enable news signals, pure-AI estimates, `--llm` rule diffs. All current keys are dead.
3. **Schedules**: `pm-ingest.ts refresh` every 6 h; `pm-run-all.sh` after it; `snapshotTopMarkets` (books) hourly for spoof/time-of-day analytics; daily price snapshots for backtests. Set `CRON_SECRET` before exposing `/api/cron/*`.
4. **Insider coverage**: `pm-insider.ts scan` pulls market-level tapes for the top 20 non-sports markets; widen when the thin-move backtest should be trusted (it needs all-wallet volume).
5. **Polygonscan key** for funding-chain tracing (`traceFunding` stub).
6. **Landing copy** still claims things the product does not do; **payments** have no webhook (FastSpring sandbox, Bitcart stub); `/dashboard` requires login but not a subscription.
7. Delete the 12.5k placeholder rows: `DELETE FROM whale_signals WHERE source='html-scrape-v1'` (after the migration) and the 4 seeded `contrarian_signals`.
8. Commit. Suggested first commit: everything except `data/`.

## 5. Audit trail (what was wrong in the January build)

Seeded/forced news signals (4 rows, all test data) · whale scraper wrote `YES/$500/0.50` for trending-sidebar links, 12,502 rows, hourly cron still running via cron-job.org on an unauthenticated endpoint · pure-AI inserts failed on column names (0 rows) · Gamma sorted by string volume · GDELT called in parallel against a 1-req/5-s limit, tone read from an image URL · OpenAI 401, Gemini project without model access · `/dashboard` public · pricing $49 vs code $29, no payment webhook. All fixed or documented above; the legacy lanes stay in `lib/intelligence/` for when a key exists.
