# Browser QA (Playwright)

```
cd qa && npm init -y >/dev/null && npm i playwright && npx playwright install chromium
node sweep.mjs          # every page at 1280 and 390 px: console/page errors, failed requests, 4xx/5xx, NaN/undefined, overflow, empty tables, 40 internal links; screenshots in qa/shots/
node interactions.mjs   # alerts create/toggle/delete, markets search, market → wallet drill-down, wallet filters, journal export, tax CSV, JSON API, legacy dashboard
```
Both expect `npm run dev` on http://localhost:3000. Last clean run: 2026-09-25 (46 page loads, 0 errors, 0 overflow, 16/16 interactions).
