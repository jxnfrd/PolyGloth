# PolyGloth v2 build plan (started 2026-09-25 · all five phases built the same day; see HANDOVER.md for run order and open items)

Source spec: "Polymarket & Kalshi Mega List" (pasted 2026-09-25). Everything below runs on free, keyless data:
Polymarket Gamma (`gamma-api.polymarket.com`), Data API (`data-api.polymarket.com`), CLOB (`clob.polymarket.com`),
Kalshi public (`api.elections.kalshi.com/trade-api/v2`). Storage: SQLite via Node's built-in `node:sqlite`
(no native deps) at `data/polygloth.sqlite`. Dashboard pages read SQLite through Next.js route handlers (localhost).
Supabase stays for auth + the legacy tables.

## What is NOT built, and why
- Live order execution / copy bots / auto-fade bots: need your private key and funds. Everything is **paper** mode with the same risk controls, so a live adapter is a small last step.
- Funding-chain tracing (Polygonscan): needs an API key; hook left in `lib/intel/insider.ts`.
- LLM features (rules-vs-headline gap, AI probability bot): wired through `lib/intelligence/llm.ts` but need a working key.
- Kalshi trader identities: Kalshi trades are anonymous; only flow analytics + market matching for arbitrage.

## Phases
| Phase | Modules | Spec sections |
|---|---|---|
| 1 Foundation | `lib/pm/{http,gamma,data-api,clob,kalshi,db,categories,ingest}.ts`, `scripts/pm-ingest.ts`, tests | 12 |
| 2 Trader intelligence | `lib/intel/wallet-score.ts` (calibrated ROI, category record, edge decay, conviction, entry timing, lifecycle, hedge, consensus/divergence), `fade.ts` (anti-leaderboard, bias fingerprint, fade score, crowd-of-losers, fade backtest), `insider.ts` (fresh wallet, niche concentration, sniper clusters, one-and-done, flag ledger) | 2, 3, 4, 13.1–7 |
| 3 Execution (paper) + risk | `copy-paper.ts` (price offset, proportional sizing, category filter, caps, exit mirroring, liquidity check, copy-lag report, leader basket), `risk.ts` (Kelly/EV, Kalshi fee, Brier calibration, scenario P/L, correlation exposure, drawdown breaker), `strategies.ts` + `backtest.ts` (near-certainty harvester, mean reversion, deadline decay, unified backtester with fees/slippage) | 5, 9, 10 |
| 4 Market intelligence | `sentiment.ts` (commenter P/L overlay, talk-vs-wallet divergence, velocity spike, smart-commenter feed, leak phrases, contrarian mood), `microstructure.ts` (aggressor imbalance, depth/slippage map, thin-move reversion, resolution drift, time-of-day), `arb.ts` (multi-outcome sum, ladder, logical, cross-venue Kalshi, lock-up return, rule diff), `resolution.ts` (early-resolution scanner, clarification diff, dispute-prone markets) | 6, 7, 8, 11 |
| 5 Surface | `/intel/*` pages + `/api/intel/*` routes, alert composer, weekly edge report | 13.21–30 |

Each module ships with `tests/<module>.test.ts` (node:test) and a CLI in `scripts/pm-*.ts`. A module is "done" only when its test passes against live data and its numbers are sanity-checked by hand.

## Status 2026-09-25
| Phase | Tests | Hand-verified example |
|---|---|---|
| 1 Foundation | 7/7 | Rams −6.5 resolves to index 0 via CLOB; Gamma sorted by real 24h volume |
| 2 Trader intelligence | 14/14 | raybanman: 21 resolved (2 hedged excluded), P/L −$20,459, calibrated ROI −0.011, p 0.265, recomputed from raw trades |
| 3 Execution + risk | 15/15 | kelly(0.6,0.5)=0.2; Kalshi fee 100×0.5 = $1.75; liquidity-capped size $1,620 solved by hand |
| 4 Market intelligence | 18/18 | Iran-invasion NO flow imbalance 0.97; Fed Dec all-NO edge 0.20 %; Brazil election 469 comments idempotent |
| 5 Surface | manual | every /intel page returns 200 on the live store |

Not built: live execution (no key), funding-chain tracing (Polygonscan key), LLM paths (no key), book-snapshot schedules (spoof/time-of-day need hours of snapshots).
