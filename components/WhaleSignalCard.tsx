import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

const usd = (n: number | null | undefined) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`;
const pct = (p: number | null | undefined) => p == null ? '—' : `${Math.round(p * 100)}¢`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function WhaleSignalCard({ signal }: { signal: any }) {
    const isHigh = signal.signal_strength === 'high';
    const isMedium = signal.signal_strength === 'medium';
    const pnl = Number(signal.pnl_usd ?? 0);
    const trader = signal.tracked_traders || {};
    const href = signal.market_slug ? `https://polymarket.com/event/${signal.market_slug}` : '#';

    return (
        <div className="overflow-hidden rounded-xl bg-gray-900 ring-1 ring-white/10 hover:ring-blue-500/50 transition-all duration-300">
            <div className="p-6">
                <div className="flex items-center justify-between gap-x-4 mb-4">
                    <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-blue-400/10 px-2 py-1 text-xs font-medium text-blue-400 ring-1 ring-inset ring-blue-400/20">🐋 WHALE</span>
                        <span className="inline-flex items-center rounded-full bg-gray-800 px-2 py-1 text-xs font-medium text-gray-400 ring-1 ring-inset ring-gray-700" title={trader.display_name || ''}>
                            #{trader.leaderboard_rank ?? '?'} · 30d P/L {usd(trader.total_profit)}
                        </span>
                    </div>
                </div>

                <h3 className="text-lg font-semibold leading-6 text-white min-h-[3rem] line-clamp-2 mb-3">
                    <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">{signal.market_question}</a>
                </h3>

                <div className="bg-gray-800/50 rounded-lg p-3 mb-4 flex justify-between items-center">
                    <div>
                        <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">Holding</span>
                        <div className={`text-xl font-bold ${/^no$/i.test(signal.outcome_label || '') ? 'text-red-400' : 'text-green-400'}`}>{signal.outcome_label || signal.trader_action}</div>
                    </div>
                    <div className="text-right">
                        <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">Position now</span>
                        <div className="text-white font-mono">{usd(signal.current_value_usd)}</div>
                        <div className="text-xs text-gray-500 font-mono">paid {usd(signal.position_size_usd)}</div>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs text-gray-400 mb-4 border-t border-gray-800 pt-3">
                    <div><span className="block text-gray-500">Entry</span><span className="text-white font-medium">{pct(signal.average_buy_price)}</span></div>
                    <div><span className="block text-gray-500">Now</span><span className="text-white font-medium">{pct(signal.current_price)}</span></div>
                    <div><span className="block text-gray-500">Unrealized</span><span className={`font-medium ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}{usd(pnl)}</span></div>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-600 border-t border-gray-800 pt-3">
                    <div className="flex items-center gap-1">
                        <span className={`h-2 w-2 rounded-full ${isHigh ? 'bg-green-500' : isMedium ? 'bg-yellow-500' : 'bg-gray-500'}`}></span>
                        <span className="capitalize">{signal.signal_strength} · seen {signal.last_seen_at ? new Date(signal.last_seen_at).toLocaleDateString() : '—'}</span>
                    </div>
                    <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-white transition-colors">
                        Open market <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                    </a>
                </div>
            </div>
        </div>
    );
}
