'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const INTEL_NAV: [string, string, string][] = [
    ['/intel', 'Overview', 'Store health, signal ledger and the latest signals'],
    ['/intel/wallets', 'Wallets', 'Wallets ranked by calibrated ROI per category and window; flip to the fade list'],
    ['/intel/whales', 'Whale book', 'Open positions of the leaderboard wallets, largest first'],
    ['/intel/markets', 'Markets', 'Every market in the store: price, book, volume, category, resolution'],
    ['/intel/signals', 'Signals', 'All signal types with their resolved outcome once the market settles'],
    ['/intel/arb', 'Arb', 'Multi-outcome sums, ladder and logical violations, Polymarket ↔ Kalshi pairs'],
    ['/intel/flow', 'Flow', 'Thin moves, spoof suspects and last-cents yield candidates'],
    ['/intel/sentiment', 'Sentiment', 'Comment activity, spikes, talk-vs-wallet divergence, leak phrases, shills'],
    ['/intel/resolution', 'Resolution', 'Early-resolution gaps, rule changes, dispute-prone markets'],
    ['/intel/paper', 'Paper', 'Paper copy orders and strategy P/L (no live orders)'],
    ['/intel/journal', 'Journal', 'Auto-tagged journal, which reasons pay, attribution, portfolio, tax export'],
    ['/intel/alerts', 'Alerts', 'Composable alert rules and what fired'],
    ['/intel/report', 'Edge report', 'This week vs last: what worked, what decayed'],
    ['/intel/kalshi', 'Kalshi', 'Open Kalshi markets from the public API']
];

export default function IntelNav() {
    const path = usePathname() || '/intel';
    const active = INTEL_NAV.find(([h]) => h !== '/intel' && path.startsWith(h)) ?? INTEL_NAV[0];
    return (
        <div className="mb-6 border-b border-zinc-800 pb-3">
            <div className="flex flex-wrap items-center gap-1">
                <span className="mr-3 font-mono text-sm text-zinc-500">polygloth/intel</span>
                {INTEL_NAV.map(([href, label]) => (
                    <Link key={href} href={href} className={`rounded px-2 py-1 text-sm ${active[0] === href ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'}`}>{label}</Link>
                ))}
            </div>
            <h1 className="mt-4 text-xl font-semibold text-white">{active[1]}</h1>
            <p className="mt-1 text-sm text-zinc-500">{active[2]}</p>
        </div>
    );
}
