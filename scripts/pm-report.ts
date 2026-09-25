import { config } from 'dotenv'; config({ path: '.env.local' });
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDb } from '../lib/pm/db';
import { build, toMarkdown, saveLatest } from '../lib/report/edge-report';

/** Usage: npx tsx scripts/pm-report.ts [days=7]  → prints Markdown, writes reports/edge-YYYY-MM-DD.md, stores JSON for /intel/report */
(() => {
    openDb();
    const r = build(Math.floor(Date.now() / 1000), Number(process.argv[2]) || 7);
    const md = toMarkdown(r);
    saveLatest(r);
    const dir = path.resolve(process.cwd(), 'reports'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `edge-${new Date().toISOString().slice(0, 10)}.md`);
    fs.writeFileSync(file, md);
    console.log(md);
    console.log(`\nwritten ${file}`);
})();
