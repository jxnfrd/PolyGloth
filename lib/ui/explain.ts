/**
 * Plain-English layer for the dashboard: glossary, human labels for signal types,
 * and a renderer that turns a stored signal (type + payload) into one readable sentence.
 * Everything a page shows should be explainable from here.
 */

export const GLOSSARY: Record<string, string> = {
    'calibrated ROI': 'Profit per dollar of risk taken. Winning a 95¢ favourite counts for little (it was expected); winning a 20¢ longshot counts for a lot. Positive = beats the odds, negative = loses to them.',
    'ROI': 'Profit divided by money staked, plain and simple. +10% means $10 made per $100 bet.',
    'p-value': 'Chance that a record this good is pure luck. 0.05 = 5% chance it is luck. Below 0.1 we call it significant; below 0.01 we take it seriously.',
    'Brier': 'How far the wallet\'s entry prices were from what actually happened (0 = perfect, 0.25 = coin-flip). Lower is better.',
    'resolved': 'Positions in markets that have already settled to YES or NO, so the outcome is known.',
    'win %': 'Share of resolved positions that paid out.',
    'staked': 'Total dollars the wallet paid for the positions counted here.',
    'avg entry': 'Average price paid per share. 76¢ means the wallet mostly buys favourites; 20¢ means longshots.',
    'longshots': 'Share of positions bought at 30¢ or less.',
    'timing (pp)': 'Average price move in the wallet\'s favour in the 24 hours after it entered, in cents. Positive = it tends to get in before the crowd. Blank when there is no price history to measure it.',
    'LB rank': 'Rank on Polymarket\'s public 30-day profit leaderboard.',
    'equal-weight ROI': 'Return if you had put the same $1 on every position, ignoring how big the wallet\'s bets were. The number a copier with fixed size would see.',
    '$-weighted ROI': 'Return on the actual dollars staked. Dominated by whatever the biggest bettor did.',
    'walk-forward': 'Rank wallets using only what was known before a cutoff date, then measure what their trades after that date earned. The honest test: no peeking at the answer.',
    'sharp': 'Wallets with 30+ resolved positions, positive calibrated ROI and a p-value under 0.1 before the cutoff.',
    'fade': 'Wallets whose record is significantly worse than the odds. "Fading" means betting against them.',
    'control': 'Every other wallet with 30+ resolved positions. If sharp wallets do not beat this group, the ranking has no edge.',
    'neg-risk event': 'An event with several mutually exclusive outcomes (one winner). All YES prices should add up to about $1.',
    'ladder': 'A set of markets on the same number at different thresholds ("above 84k", "above 86k"). A higher threshold can never be more likely than a lower one.',
    'cross-venue': 'The same question priced on Polymarket and Kalshi. If YES on one plus NO on the other costs less than $1, both sides can be bought for a locked profit, provided the rules match.',
    'taker flow': 'Who is hitting the button. BUY = someone paid the ask to get in, SELL = someone hit the bid to get out. Lopsided flow often leads price.',
    'depth': 'How many dollars can be traded before the price moves by a given amount. Small depth = your own order moves the market.',
    'thin move': 'A big price jump on very little volume. These often snap back.',
    'last-cents yield': 'Buying a market at 97–99¢ that is almost certainly decided and holding to $1. Small, steady, and dangerous when the market is less certain than it looks.',
    'dispute risk': 'How vague the resolution rules are (no named source, "credible reporting", discretion clauses). Vague rules get disputed and resolved against what the headline suggested.',
    'paper': 'Simulated orders. Nothing is sent to an exchange; the system records what it would have done and marks it to market.',
    'slippage': 'The gap between the price you saw and the price you actually get. We charge 0.5% on every simulated fill.',
    'signal': 'A dated observation the system recorded, with a score and a reason. Signals are graded WIN/LOSS once the market resolves, so every type has a public hit rate.',
    'consensus': 'Two or more sharp wallets bought the same side of the same market within a short window.',
    'divergence': 'Sharp wallets are net buying one side while most of the volume is on the other side.',
    'insider': 'Trade patterns that look informed: brand-new wallets placing large bets, one-and-done wallets, clusters of young wallets buying together.',
    'category': 'Politics, sports, crypto, economy, science & tech, culture, geopolitics, business. Assigned from Polymarket\'s tags.'
};

export const SIGNAL_LABEL: Record<string, string> = {
    consensus: 'Sharp wallets agree', divergence: 'Sharp money vs the crowd', fade: 'Losing wallet bought', insider: 'Looks informed',
    arb_multi_outcome: 'Outcomes sum below $1', arb_ladder: 'Ladder mispriced', arb_logical: 'Logic mispriced', arb_cross_venue: 'Polymarket vs Kalshi gap',
    thin_move: 'Thin move', spoof_suspect: 'Vanishing wall', comment_spike: 'Comment spike', talk_wallet_divergence: 'Says one thing, holds the other',
    leak_phrase: 'Claims inside info', shill_cluster: 'Coordinated comments', early_resolution: 'Decided but not priced', rules_changed: 'Rules edited', source_changed: 'Source page changed'
};

export const SIGNAL_MEANING: Record<string, string> = {
    consensus: 'Several wallets with a proven record took the same side at about the same time. Worth a look, not a trade by itself.',
    divergence: 'The wallets with the best records are on the opposite side from most of the money. Historically the crowd side is where retail piles in.',
    fade: 'A wallet that reliably loses to the odds just bought. The opposite side is the candidate trade, at the same price.',
    insider: 'Unusual entries: fresh wallets betting big, wallets that trade once and vanish, or clusters of young wallets. Many are false alarms; the ledger tracks how often they were right.',
    arb_multi_outcome: 'Buying every outcome of a one-winner event costs less than the $1 it will pay. Check every leg has a real order book.',
    arb_ladder: 'Within one threshold ladder, a higher bar is priced above a lower one. Sell the expensive leg, buy the cheap one.',
    arb_logical: 'A narrower event (earlier deadline, winning the presidency) is priced above the broader one it implies. Same fix as a ladder.',
    arb_cross_venue: 'The same question is cheaper on one venue. Read both rule texts first: resolution times and sources differ more often than prices do.',
    thin_move: 'Price jumped on almost no volume. The suggested side fades half the move.',
    spoof_suspect: 'A large resting order appeared and disappeared without trading. Someone may be painting the book.',
    comment_spike: 'Comment volume on this event is several times its normal rate. Often precedes news or a price move.',
    talk_wallet_divergence: 'A commenter argues for one side while their wallet holds the other. Classic pump-to-exit.',
    leak_phrase: 'A comment uses insider language ("hearing that", "just confirmed"). Weighted by the commenter\'s track record when known.',
    shill_cluster: 'Several accounts posted near-identical text within hours.',
    early_resolution: 'The exchange already knows the winner but the price has not reached $1 or $0. Check the dispute status before touching it.',
    rules_changed: 'Polymarket edited the resolution text. Prices usually lag clarifications.',
    source_changed: 'The page named as the resolution source changed content.'
};

type P = Record<string, unknown>;
const n = (v: unknown, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x.toFixed(d) : '?'; };
const pct = (v: unknown, d = 0) => { const x = Number(v); return Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '?'; };
const cents = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) + '¢' : '?'; };
const usd = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? '$' + Math.round(x).toLocaleString() : '?'; };
const q = (v: unknown, max = 70) => { const s = String(v ?? '').trim(); return s.length > max ? s.slice(0, max) + '…' : s; };

/** One readable sentence for a stored signal row (type, payload, joined market columns). */
export function describeSignal(row: { type: string; payload?: unknown; question?: unknown; event_slug?: unknown; outcome_index?: unknown; yes_price?: unknown; score?: unknown; wallet?: unknown }): string {
    const p = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as P;
    const market = q(row.question || p.question || p.event_slug || row.event_slug || 'this market');
    const side = row.outcome_index == null ? '' : Number(row.outcome_index) === 0 ? 'YES' : 'NO';
    switch (row.type) {
        case 'consensus': return `${(p.wallets as unknown[] | undefined)?.length ?? 'Several'} sharp wallets bought ${side} on "${market}" (${usd(p.usdc)} between them).`;
        case 'divergence': return `Sharp wallets are net ${side} on "${market}" while ${pct(p.crowd_share_other)} of the volume is on the other side.`;
        case 'fade': return `A wallet with a significantly losing record bought ${side === 'YES' ? 'NO' : 'YES'} on "${market}"; the fade is ${side} at ${cents(p.price ?? p.entryPrice ?? row.yes_price)}. Fade score ${n(row.score)}/100.`;
        case 'insider': { const reasons = (p.reasons as string[] | undefined) ?? []; const why = reasons.map(r => ({ fresh_big: 'a wallet under 48h old bet big', niche: 'one trade was over 5% of the market\'s daily volume', sniper: 'several young wallets bought together within minutes', one_and_done: 'a wallet that has only ever made this trade', improbable_record: 'a wallet whose record is too good to be luck' }[r] ?? r)).join('; '); return `${usd(p.usdc)} on ${side} of "${market}" at ${cents(p.price)}: ${why}. Suspicion ${n(row.score)}/10.`; }
        case 'arb_multi_outcome': return `Buying every ${p.kind === 'all_yes' ? 'YES' : 'NO'} in "${q(p.event_slug)}" costs ${n(p.sumAsk, 3)} for a payout of ${p.kind === 'all_yes' ? '$1' : `$${Number(p.legs) - 1}`}: ${pct(Number(p.edge) / Math.max(1e-9, Number(p.sumAsk)), 1)} locked gross edge across ${p.legs} legs.`;
        case 'arb_ladder': { const lo = (p.lower ?? {}) as P, hi = (p.higher ?? {}) as P; return `"${q(hi.question, 45)}" trades at ${cents(hi.pYes)} but the easier "${q(lo.question, 45)}" trades at ${cents(lo.pYes)}: ${cents(p.spread)} mispricing.`; }
        case 'arb_logical': { const a = (p.narrower ?? {}) as P, b = (p.broader ?? {}) as P; return `"${q(a.question, 45)}" (${cents(a.pYes)}) cannot be likelier than "${q(b.question, 45)}" (${cents(b.pYes)}): ${cents(p.spread)} gap.`; }
        case 'arb_cross_venue': return `"${market}": ${String(p.leg).includes('buy_yes_pm') ? 'buy YES on Polymarket and NO on Kalshi' : 'buy NO on Polymarket and YES on Kalshi'} (${String(p.ticker)}) for ${n(p.cost, 3)} total, ${pct(p.edge, 1)} edge after Kalshi's fee; title match ${pct(p.confidence)}.`;
        case 'thin_move': return `"${market}" moved ${n(p.moveCents)}¢ in an hour on ${usd(p.windowUsd ?? p.volumeUsd)} of volume (daily volume ${usd(p.volume24hr)}). Fade candidate: ${String(p.fadeSide)}.`;
        case 'spoof_suspect': return `A ${usd(p.size)} ${String(p.side)} order at ${cents(p.price)} on "${market}" vanished without trading (${n(Number(p.size) / Math.max(1, Number(p.medianLevelSize)))}× the typical level).`;
        case 'comment_spike': return `Comments on "${q(p.slug)}" ran at ${p.lastHour} in the last hour against a normal ${n(p.meanHourly, 1)} per hour (${n(p.z, 1)} standard deviations).`;
        case 'talk_wallet_divergence': return `A commenter on "${q(p.slug)}" argues ${String(p.stance)} but holds ${String(p.held)}: "${q(p.body, 90)}"`;
        case 'leak_phrase': return `On "${q(p.slug)}" a commenter claims inside knowledge (${(p.phrases as string[] | undefined)?.join(', ')}): "${q(p.body, 90)}"`;
        case 'shill_cluster': return `${(p.wallets as unknown[] | undefined)?.length ?? p.n} accounts posted near-identical text on "${q(p.slug)}": "${q(p.sample, 80)}"`;
        case 'early_resolution': return `"${market}" is already decided (${String(p.source)}${p.uma ? ', ' + String(p.uma) : ''}) but still trades at ${cents(p.yes_price)}: ${p.gapCents}¢ gap. Dispute risk ${p.disputeRisk}/100.`;
        case 'rules_changed': return `Resolution rules of "${market}" were edited.`;
        case 'source_changed': return `The resolution source page for "${market}" changed (${String(p.url)}).`;
        default: return `${row.type} on "${market}".`;
    }
}

export const PAGE_HELP: Record<string, { what: string; read: string[]; act: string }> = {
    overview: { what: 'The state of the data and what it is saying right now.', read: ['The boxes show how much history the system has. Small numbers mean weak conclusions.', 'The ledger shows every kind of signal the system produces and, once markets resolve, how often each kind was right. A type with no hit rate has not been graded yet.'], act: 'Start with "What the data says today" below, then follow the links.' },
    wallets: { what: 'Every wallet the system has trade history for, ranked by how well it beats the odds.', read: ['Calibrated ROI is the ranking metric: profit per unit of risk, so longshot hits count more than favourite wins.', 'p-value says whether the record could be luck. Under 0.1 is interesting, under 0.01 is real.', 'Flip "sharpest" to "fade list" to see the wallets that lose to the odds most reliably.'], act: 'Click a wallet for its full record by category. Then read the Backtest page before copying anyone: at today\'s sample size this ranking did not predict future returns.' },
    whales: { what: 'What the biggest leaderboard wallets are holding right now.', read: ['"Paid" is what they put in, "now" is what it is worth at the current price. The gap is their unrealised profit.', 'Positions are a book, not a record: winners get redeemed and disappear, so do not read win rates off this page.'], act: 'Cross-check a holder on the Wallets page before treating a big position as a signal.' },
    markets: { what: 'Every market the system knows, with price, order book and volume.', read: ['"yes" is the current probability the market assigns. "bid/ask" is where you can actually sell/buy.', 'neg-risk means one of several outcomes wins; those events get the multi-outcome arb check.'], act: 'Open a market to see who is holding it, the taker flow, and the resolution rules.' },
    signals: { what: 'Everything the system noticed, newest first, each as a sentence.', read: ['Score is the type\'s own 0–100 (or 0–10 for insider) strength.', 'Outcome fills in when the market resolves: WIN if the side the signal pointed to paid out.'], act: 'Filter by type; check the hit rate on the Overview before trusting any type.' },
    arb: { what: 'Price inconsistencies that can, in principle, be locked in for a profit.', read: ['Every leg here has a live two-sided order book; placeholder quotes are excluded.', 'Cross-venue pairs list the title-match confidence. Always compare both rule texts: same-day Bitcoin markets resolve at different hours on the two venues.'], act: 'Treat edges under 2% as noise once fees, slippage and capital lock-up are counted.' },
    flow: { what: 'Order-book and trade-flow reads on the busiest markets.', read: ['Thin moves are price jumps on tiny volume; the suggested side fades half the move.', 'Last-cents yield lists near-certain markets and what holding them to $1 would earn, annualised. A fat yield usually means the market is not as certain as it looks.'], act: 'Check dispute risk on the Resolution page before harvesting last cents.' },
    sentiment: { what: 'What people are saying in market comments, tied to what their wallets actually hold.', read: ['Every commenter is a wallet, so talk can be checked against positions.', 'Spikes in comment volume often precede news.'], act: 'Use the "says one thing, holds the other" list as a red flag on confident comments.' },
    resolution: { what: 'Where the rules, not the headline, decide the money.', read: ['Early-resolution gaps are markets the exchange already decided that still trade away from $1 or $0.', 'Dispute risk scores the vagueness of the rule text: no named source, "credible reporting", discretion clauses.'], act: 'Before any trade, read the rules panel on the market page.' },
    paper: { what: 'Simulated orders from the copy engine and rule strategies. Nothing is sent to an exchange.', read: ['Rejected orders show why the risk rules said no: caps, price moved, thin liquidity.', 'P/L is marked at the current price until the market resolves.'], act: 'Run the copy engine for a few weeks in paper before considering real money.' },
    journal: { what: 'Every paper order with the reasons it was placed, and which reasons actually made money.', read: ['Tags come from the strategy and from signals present on the market at the time.', 'Attribution splits results into skill (the price you targeted), slippage (what you actually paid), fees and luck.'], act: 'Kill the tags that lose; keep the ones that pay.' },
    alerts: { what: 'Rules that watch the signal stream and notify you.', read: ['A rule is a filter: signal types, score, category, price range, wallet quality, and optionally a second signal type within N minutes.', 'Telegram delivery switches on when a bot token and chat id are set.'], act: 'Start from the four default rules and tighten them as hit rates come in.' },
    report: { what: 'This week against last: what fired, what hit, what decayed.', read: ['Decayed = a signal type whose hit rate dropped by 15 points or more.', 'Edge flips = wallets whose 30-day and 90-day records disagree.'], act: 'Read it Monday morning.' },
    backtest: { what: 'The honest test of the core idea: does ranking wallets predict what they earn next?', read: ['Walk-forward means the ranking uses only what was known before the cutoff, and returns are measured after it.', 'Equal-weight ROI is what a copier with fixed size would see; dollar-weighted is dominated by the biggest bettor.', 'If "sharp" does not beat "control", the ranking has no edge yet.'], act: 'Do not copy on this evidence. More wallets and longer history are what would change it.' },
    kalshi: { what: 'Open Kalshi markets from its public API, used for cross-venue comparison.', read: ['Kalshi traders are anonymous, so only prices and flow are available.'], act: 'See the Arb page for matched pairs.' }
};
