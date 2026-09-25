# PolyGloth JSON API + MCP server

Both read the local SQLite store (`data/polygloth.sqlite`, or `POLYGLOTH_DB`). They never call Polymarket/Kalshi
except `arb?live=1` / `arb_opportunities(live=true)`, which re-run the live arbitrage scanners (slow, writes `signals`).

## JSON API (Next.js route handlers, `app/api/intel/*`)

Auth: if `INTEL_API_KEY` is set in `.env.local`/Vercel, send `x-api-key: <key>` (or `?api_key=`). Unset = open (localhost).
Every response: `{ "ok": true, "data": …, "generatedAt": "<ISO>" }` or `{ "ok": false, "error": "…" }`.

| Route | Query | Returns |
|---|---|---|
| `GET /api/intel/stats` | — | row counts, freshness timestamps, signal ledger by type |
| `GET /api/intel/wallets` | `cat` (all/politics/sports/crypto/economy/…), `win` (0/30/90), `order` (best/worst), `min` (min resolved, 30), `limit` | wallet_scores joined with wallets, sorted by calibrated ROI |
| `GET /api/intel/wallets/{0xproxy}` | `trades` (≤200) | wallet, scores per category/window, notional by category, signals, trade tape with WIN/LOSS |
| `GET /api/intel/markets` | `q`, `category`, `state` (open/resolved/all), `order` (volume24hr/volume/end_ts), `limit` | markets |
| `GET /api/intel/markets/{0xconditionId}` | `trades` (≤300), `comments` (≤50) | market, event, siblings, 24h flow, holders with scores, signals, comments, latest book snapshot, stored prices |
| `GET /api/intel/signals` | `type`, `since` (unix s), `limit` (≤300) | signals with market context and outcome |
| `GET /api/intel/arb` | `minEdge` (0.005), `limit`, `live=1` | stored `arb_*` signals grouped by type; with `live=1` also a fresh scan |

```bash
curl -s 'http://localhost:3000/api/intel/stats' | jq .data.stats
curl -s 'http://localhost:3000/api/intel/wallets?cat=economy&win=90&order=best&min=20&limit=10' | jq '.data[] | {wallet, calibrated_roi, p_value, n_resolved}'
curl -s 'http://localhost:3000/api/intel/wallets/0x2c335066fe58fe9237c3d3dc7b275c2a034a0563?trades=5' | jq '.data.scores'
curl -s 'http://localhost:3000/api/intel/markets?q=Fed&category=economy&limit=5' | jq '.data[] | {question, yes_price, volume24hr}'
curl -s 'http://localhost:3000/api/intel/markets/0xd0e58ada317f9778a221592cfed03405b235b137c8dd916817a39b72bf6dc19a' | jq '.data.flow'
curl -s 'http://localhost:3000/api/intel/signals?type=consensus&limit=20' | jq '.data[] | {ts, question, score, outcome}'
curl -s 'http://localhost:3000/api/intel/arb?minEdge=0.01' | jq '.data.groups[] | {type, n}'
curl -s -H 'x-api-key: SECRET' 'https://your-host/api/intel/stats'
```

## MCP server (`scripts/pm-mcp.ts`)

Stdio JSON-RPC 2.0 (MCP 2024-11-05: `initialize`, `tools/list`, `tools/call`, `ping`), no SDK dependency.
Tools: `db_stats`, `top_wallets`, `wallet_report`, `search_markets`, `market_detail`, `recent_signals`,
`arb_opportunities`, `whales_in_category_today` (e.g. "which top wallets entered Fed markets today?" →
`{ "category": "economy", "hours": 24 }`: scored wallets with calibrated ROI > 0 and p < 0.1 that traded that
category, with buy/sell notional and the markets).

Register with Claude Code from the repo root:
```bash
claude mcp add polygloth -- npx tsx scripts/pm-mcp.ts
# or, from anywhere, pin the DB path:
claude mcp add polygloth -e POLYGLOTH_DB=/ABS/PATH/PolyGloth/data/polygloth.sqlite -- npx --prefix /ABS/PATH/PolyGloth tsx /ABS/PATH/PolyGloth/scripts/pm-mcp.ts
```
`.mcp.json.example` at the repo root is the equivalent project-scoped config (copy to `.mcp.json`, fill the absolute paths).
Manual smoke test:
```bash
printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npx tsx scripts/pm-mcp.ts
```

## Scheduler (`scripts/pm-daemon.ts`)

One process, one job at a time (SQLite single writer). `--dry` prints the schedule, `--once <job>` runs one job.
Jobs: refresh (6 h) → chain (after each refresh) · kalshi (6 h) · prices (24 h) · books (1 h) · alerts (15 min, when `lib/alerts/alerts.ts` exists).
State lives in the `kv` table (`daemon:job:*`). macOS launchd template: `ops/com.polygloth.daemon.plist`.
Do not run `pm-ingest.ts`/`pm-run-all.sh` by hand while the daemon is loaded.
