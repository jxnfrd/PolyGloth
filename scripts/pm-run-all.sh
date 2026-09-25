#!/usr/bin/env bash
# Sequential analytics chain (SQLite allows one writer at a time). Usage: bash scripts/pm-run-all.sh [resolutionLimit=40000]
set -u
cd "$(dirname "$0")/.."
LIM="${1:-40000}"
step() { echo; echo "===== $(date +%H:%M:%S) $* ====="; }
step resolutions;  npx tsx scripts/pm-ingest.ts resolutions "$LIM"
step kalshi;       npx tsx scripts/pm-ingest.ts kalshi
step snapshots;    npx tsx -e "import('./lib/pm/ingest').then(async m => { const { all } = await import('./lib/pm/db'); const ws = all('SELECT address FROM wallets WHERE lb_rank_pnl_month IS NOT NULL ORDER BY lb_rank_pnl_month LIMIT 40'); for (const w of ws) console.log(w.address.slice(0,10), await m.snapshotPositions(w.address)); })"
step score;        npx tsx scripts/pm-score.ts all
step score-top;    npx tsx scripts/pm-score.ts top
step fade;         npx tsx scripts/pm-fade.ts all
step insider;      npx tsx scripts/pm-insider.ts scan 20 3
step arb;          npx tsx scripts/pm-arb.ts --no-kalshi-fetch
step flow;         npx tsx scripts/pm-flow.ts top 8
step sentiment;    npx tsx scripts/pm-sentiment.ts top 300 20
step resolution;   npx tsx scripts/pm-resolution.ts
step backtest;     npx tsx scripts/pm-backtest.ts all 90 --no-sports
step paper-poll;   npx tsx scripts/pm-paper.ts poll
step paper;        npx tsx scripts/pm-paper.ts report
step journal;      npx tsx scripts/pm-journal.ts sync
step alerts;       npx tsx scripts/pm-alerts.ts evaluate 168
step report;       npx tsx scripts/pm-report.ts
step stats;        npx tsx scripts/pm-ingest.ts stats
echo "===== $(date +%H:%M:%S) chain done ====="
