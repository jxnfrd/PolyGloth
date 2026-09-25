// Browser QA sweep: console errors, page errors, failed requests, empty tables, broken internal links, mobile overflow.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const PAGES = ['/', '/intel', '/intel/wallets', '/intel/wallets?order=worst&cat=sports', '/intel/whales', '/intel/markets', '/intel/markets?q=Fed&cat=economy', '/intel/signals', '/intel/signals?type=insider', '/intel/arb', '/intel/flow', '/intel/sentiment', '/intel/resolution', '/intel/paper', '/intel/journal', '/intel/journal?tab=tags', '/intel/journal?tab=attribution', '/intel/journal?tab=portfolio', '/intel/alerts', '/intel/report', '/intel/kalshi', '/dashboard', '/dashboard?view=whales'];
const OUT = new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const report = [];
const visitedLinks = new Set();

for (const width of [1280, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    for (const path of PAGES) {
        const page = await ctx.newPage();
        const issues = [];
        page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text().slice(0, 200)); });
        page.on('pageerror', e => issues.push('pageerror: ' + String(e).slice(0, 200)));
        page.on('requestfailed', r => issues.push('reqfail: ' + r.url().slice(0, 120) + ' ' + (r.failure()?.errorText ?? '')));
        page.on('response', r => { if (r.status() >= 400 && !r.url().includes('favicon')) issues.push(`http ${r.status()}: ${r.url().slice(0, 120)}`); });
        const t0 = Date.now();
        let status = 0;
        try { const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 120000 }); status = res?.status() ?? 0; } catch (e) { issues.push('nav: ' + String(e).slice(0, 120)); }
        const ms = Date.now() - t0;
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
        const tables = await page.evaluate(() => Array.from(document.querySelectorAll('table')).map(t => ({ rows: t.querySelectorAll('tbody tr').length, empty: !!t.querySelector('tbody td[colspan]') })));
        const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim().slice(0, 60) ?? '');
        const nan = await page.evaluate(() => (document.body.innerText.match(/\bNaN\b|undefined|\[object Object\]|Invalid Date/g) || []).length);
        const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="/intel"]')).map(a => a.getAttribute('href')));
        for (const l of links) visitedLinks.add(l);
        await page.screenshot({ path: `${OUT}/${width}-${path.replace(/[^a-z0-9]+/gi, '_') || 'root'}.png`, fullPage: false });
        report.push({ width, path, status, ms, overflow, tables: tables.length, emptyTables: tables.filter(t => t.empty).length, nan, h1, issues: Array.from(new Set(issues)) });
        await page.close();
    }
    await ctx.close();
}

// Link check: sample up to 40 distinct internal links found on the pages
const ctx = await browser.newContext();
const page = await ctx.newPage();
const linkResults = [];
const sample = Array.from(visitedLinks).filter(l => l && !PAGES.includes(l)).slice(0, 40);
for (const l of sample) {
    try { const r = await page.goto(BASE + l, { waitUntil: 'domcontentloaded', timeout: 120000 }); const s = r?.status() ?? 0; const txt = await page.evaluate(() => document.body.innerText.slice(0, 200)); if (s !== 200 || /Application error|not in the local store|not ingested/i.test(txt)) linkResults.push({ l, s, txt: txt.replace(/\s+/g, ' ').slice(0, 100) }); }
    catch (e) { linkResults.push({ l, s: 0, txt: String(e).slice(0, 80) }); }
}
await browser.close();

for (const r of report) console.log(`${r.width} ${r.status} ${String(r.ms).padStart(6)}ms ${r.overflow ? 'OVERFLOW' : '        '} tbl=${r.tables}/${r.emptyTables}empty nan=${r.nan} ${r.path} | ${r.h1} ${r.issues.length ? '\n     ' + r.issues.join('\n     ') : ''}`);
console.log(`\nlinks checked: ${sample.length}, problems: ${linkResults.length}`);
for (const l of linkResults) console.log('  ', l.s, l.l, '|', l.txt);
