// Interaction QA: alerts form create/toggle/delete, markets search, wallet + market drill-down, tax CSV, API.
import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 160)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' | ' + extra : ''}`);

// 1. Alerts: create a rule, see it listed, toggle it, delete it
await page.goto(BASE + '/intel/alerts', { waitUntil: 'networkidle' });
const before = await page.locator('table').first().locator('tbody tr').count();
await page.fill('input[name="name"]', 'QA rule ' + Date.now());
await page.check('input[name="signalTypes"][value="consensus"]').catch(() => {});
await page.fill('input[name="minScore"]', '10').catch(() => {});
await page.click('button:has-text("create rule")');
await page.waitForTimeout(2500); await page.reload({ waitUntil: 'networkidle' });
const after = await page.locator('table').first().locator('tbody tr').count();
ok('alerts: create rule adds a row', after === before + 1, `${before} → ${after}`);
const row = page.locator('table').first().locator('tbody tr').filter({ hasText: 'QA rule' }).first();
const toggle = row.locator('button').first();
const toggleText = (await toggle.textContent())?.trim();
await toggle.click(); await page.waitForTimeout(2500); await page.reload({ waitUntil: 'networkidle' });
const row2 = page.locator('table').first().locator('tbody tr').filter({ hasText: 'QA rule' }).first();
const toggleText2 = (await row2.locator('button').first().textContent())?.trim();
ok('alerts: toggle flips state', toggleText !== toggleText2, `${toggleText} → ${toggleText2}`);
const del = row2.locator('button').filter({ hasText: /delete|remove|×/i }).first();
if (await del.count()) { page.once('dialog', d => d.accept()); await del.click(); await page.waitForTimeout(2500); await page.reload({ waitUntil: 'networkidle' }); }
const afterDel = await page.locator('table').first().locator('tbody tr').count();
ok('alerts: delete removes the row', afterDel === before, `${afterDel} vs ${before}`);

// 2. Markets search form
await page.goto(BASE + '/intel/markets', { waitUntil: 'networkidle' });
await page.fill('input[name="q"]', 'Fed');
await page.click('button:has-text("search")');
await page.waitForLoadState('networkidle');
const url = page.url(); const rows = await page.locator('tbody tr').count();
const allFed = await page.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).every(tr => /fed/i.test(tr.textContent || '')));
ok('markets: search filters rows', url.includes('q=Fed') && rows > 0 && allFed, `${rows} rows`);

// 3. Drill-down: market row → market page → holder → wallet page
await page.click('tbody tr a[href^="/intel/markets/"]');
await page.waitForURL(/\/intel\/markets\/0x/, { timeout: 120000 }); await page.waitForLoadState('networkidle');
const mh1 = await page.locator('h1').last().textContent();
ok('markets: drill into a market', page.url().includes('/intel/markets/0x') && (mh1 || '').length > 10, (mh1 || '').slice(0, 60));
const walletLink = page.locator('a[href^="/intel/wallets/0x"]').first();
if (await walletLink.count()) { await walletLink.click(); await page.waitForURL(/\/intel\/wallets\/0x/, { timeout: 120000 }); ok('market → wallet drill-down', page.url().includes('/intel/wallets/0x'), page.url().slice(-20)); } else ok('market → wallet drill-down', false, 'no wallet link on market page');

// 4. Wallets filters
await page.goto(BASE + '/intel/wallets?cat=sports&win=30&order=worst&min=10', { waitUntil: 'networkidle' });
const heading = await page.locator('h2').first().textContent();
ok('wallets: filters reflected in heading', /Anti-leaderboard/.test(heading || '') && /sports/.test(heading || '') && /30d/.test(heading || ''), (heading || '').slice(0, 60));

// 5. Journal tabs + tax CSV
await page.goto(BASE + '/intel/journal?tab=export', { waitUntil: 'networkidle' });
const csvLink = page.locator('a[href*="/api/intel/export/tax"]').first();
ok('journal: export link present', await csvLink.count() > 0);
const csv = await page.request.get(BASE + '/api/intel/export/tax?country=ISO');
const csvText = await csv.text();
ok('tax csv: header + rows', csv.status() === 200 && /date/i.test(csvText.split('\n')[0]), csvText.split('\n')[0].slice(0, 80));

// 6. API sanity
for (const r of ['/api/intel/stats', '/api/intel/wallets?limit=2', '/api/intel/signals?limit=2', '/api/intel/arb', '/api/intel/markets?q=Fed&limit=2']) {
    const res = await page.request.get(BASE + r); let j = null; try { j = await res.json(); } catch {}
    ok(`api ${r}`, res.status() === 200 && j && j.ok === true, j ? Object.keys(j.data || {}).slice(0, 4).join(',') || (Array.isArray(j.data) ? `${j.data.length} items` : '') : 'non-json');
}

// 7. Legacy dashboard whale cards + landing link to intel
await page.goto(BASE + '/dashboard?view=whales', { waitUntil: 'networkidle' });
ok('legacy dashboard shows whale cards', (await page.locator('text=WHALE').count()) > 5);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
ok('landing links to /intel', (await page.locator('a[href="/intel"]').count()) > 0);

console.log(errs.length ? 'ERRORS:\n  ' + errs.join('\n  ') : 'no page/console errors during interactions');
await browser.close();
