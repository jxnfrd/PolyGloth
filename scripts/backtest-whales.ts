/**
 * Backtest v2: "copy whale entries" on real Polymarket data.
 * Method: for each leaderboard trader, pull trade history (/trades), group by market+outcome,
 * resolve each market via CLOB (/markets/{conditionId} -> token.winner), and compute:
 *   copyPnl  = P/L if you had copied every BUY at the whale's price and held to resolution
 *   netPnl   = whale's own realized P/L on resolved markets (buys - sells, held remainder settled at 0/1)
 * Excludes 5m/15m up-or-down scalps. Only markets that are closed with a declared winner count.
 * Cohort A: top by 30d PnL (survivorship-biased). Cohort B: top by all-time volume (activity-selected).
 */
const API = 'https://data-api.polymarket.com';
const N = Number(process.env.N || 15);
const MAX_TRADES = Number(process.env.MAX_TRADES || 1500);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function j(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url);
    if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  throw new Error(`429 after retries ${url}`);
}
const resCache = new Map<string, { closed: boolean; winner: number | null }>();
async function resolve(cid: string) {
  if (resCache.has(cid)) return resCache.get(cid)!;
  let v = { closed: false, winner: null as number | null };
  try {
    const m = await j(`https://clob.polymarket.com/markets/${cid}`);
    const wi = (m.tokens || []).findIndex((t: any) => t.winner === true);
    v = { closed: !!m.closed && wi >= 0, winner: wi >= 0 ? wi : null };
  } catch { /* unknown */ }
  resCache.set(cid, v); await sleep(120); return v;
}
async function trades(user: string) {
  const out: any[] = [];
  for (let offset = 0; offset < MAX_TRADES; offset += 500) {
    const page = await j(`${API}/trades?user=${user}&limit=500&offset=${offset}`);
    out.push(...page); if (page.length < 500) break; await sleep(250);
  }
  return out;
}
type Agg = { markets: number; resolved: number; copyWins: number; copyStaked: number; copyPnl: number; netPnl: number; sports: number; scalps: number; oldest: number };
async function analyze(user: string): Promise<Agg> {
  const ts = await trades(user);
  const a: Agg = { markets: 0, resolved: 0, copyWins: 0, copyStaked: 0, copyPnl: 0, netPnl: 0, sports: 0, scalps: 0, oldest: ts.length ? ts[ts.length - 1].timestamp : 0 };
  const groups = new Map<string, any[]>();
  for (const t of ts) {
    if (/updown|up-or-down/i.test(t.eventSlug || t.slug || '') || /Up or Down/i.test(t.title || '')) { a.scalps++; continue; }
    const k = `${t.conditionId}|${t.outcomeIndex}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(t);
  }
  a.markets = groups.size;
  for (const [k, g] of Array.from(groups.entries())) {
    const [cid, oiStr] = k.split('|'); const oi = Number(oiStr);
    if (/^(atp|wta|nfl|nba|mlb|nhl|epl|ucl|cs2|lol|dota|val|mma|ufc|ncaa|cfb|cbb|wnba|mls|bra|col|conl|unl|el2|gtm|hkt|ita|esp|ger|fra|arg|mex|jpn|kor|chn|aus|can|usa|por|ned|bel|tur|sau|uae|qat)[0-9-]/i.test(g[0].eventSlug || '')) a.sports++;
    const r = await resolve(cid); if (!r.closed) continue;
    a.resolved++;
    const won = r.winner === oi;
    let buyCost = 0, buyShares = 0, sellProceeds = 0, sellShares = 0;
    for (const t of g) { if (t.side === 'BUY') { buyCost += t.size * t.price; buyShares += t.size; } else { sellProceeds += t.size * t.price; sellShares += t.size; } }
    if (buyShares > 0) { a.copyStaked += buyCost; a.copyPnl += (won ? buyShares : 0) - buyCost; if (won) a.copyWins++; }
    const held = Math.max(0, buyShares - sellShares);
    a.netPnl += sellProceeds + (won ? held : 0) - buyCost;
  }
  return a;
}
async function cohort(label: string, url: string) {
  const lb = await j(url); const tot: Agg = { markets: 0, resolved: 0, copyWins: 0, copyStaked: 0, copyPnl: 0, netPnl: 0, sports: 0, scalps: 0, oldest: 0 };
  console.log(`\n=== Cohort ${label} (N=${N}, up to ${MAX_TRADES} trades each) ===`);
  console.log('trader'.padEnd(20), 'lbPnl'.padStart(9), 'mkts'.padStart(5), 'resol'.padStart(5), 'copyWin%'.padStart(9), 'copyStake'.padStart(10), 'copyPnl'.padStart(10), 'copyROI%'.padStart(9), 'whaleNet'.padStart(10), 'sport%'.padStart(7), 'since'.padStart(11));
  for (const t of lb.slice(0, N)) {
    try {
      const a = await analyze(t.proxyWallet);
      for (const k of Object.keys(tot) as (keyof Agg)[]) if (k !== 'oldest') tot[k] += a[k];
      console.log((t.userName || t.proxyWallet).slice(0, 18).padEnd(20), String(Math.round(t.pnl)).padStart(9), String(a.markets).padStart(5), String(a.resolved).padStart(5), (a.resolved ? (100 * a.copyWins / a.resolved).toFixed(0) : '-').padStart(9), Math.round(a.copyStaked).toString().padStart(10), Math.round(a.copyPnl).toString().padStart(10), (a.copyStaked ? (100 * a.copyPnl / a.copyStaked).toFixed(1) : '-').padStart(9), Math.round(a.netPnl).toString().padStart(10), (a.markets ? (100 * a.sports / a.markets).toFixed(0) : '-').padStart(7), (a.oldest ? new Date(a.oldest * 1000).toISOString().slice(0, 10) : '-').padStart(11));
    } catch (e: any) { console.log((t.userName || t.proxyWallet).slice(0, 18).padEnd(20), 'ERR', e.message.slice(0, 80)); }
    await sleep(300);
  }
  console.log('TOTAL'.padEnd(20), ''.padStart(9), String(tot.markets).padStart(5), String(tot.resolved).padStart(5), (tot.resolved ? (100 * tot.copyWins / tot.resolved).toFixed(1) : '-').padStart(9), Math.round(tot.copyStaked).toString().padStart(10), Math.round(tot.copyPnl).toString().padStart(10), (tot.copyStaked ? (100 * tot.copyPnl / tot.copyStaked).toFixed(1) : '-').padStart(9), Math.round(tot.netPnl).toString().padStart(10));
}
(async () => {
  await cohort('A: top by 30d PnL (survivorship-biased)', `${API}/v1/leaderboard?window=month&limit=${N}&orderBy=pnl`);
  await cohort('B: top by all-time volume (activity-selected)', `${API}/v1/leaderboard?window=all&limit=${N}&orderBy=vol`);
  console.log(`\nresolved-market cache size: ${resCache.size}`);
})().catch(e => { console.error(e); process.exit(1); });
