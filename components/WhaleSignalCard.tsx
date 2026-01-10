import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function WhaleSignalCard({ signal }: { signal: any }) {
    const isHigh = signal.signal_strength === 'high';
    const isMedium = signal.signal_strength === 'medium';

    return (
        <div className="overflow-hidden rounded-xl bg-gray-900 ring-1 ring-white/10 hover:ring-blue-500/50 transition-all duration-300">
            <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between gap-x-4 mb-4">
                    <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-blue-400/10 px-2 py-1 text-xs font-medium text-blue-400 ring-1 ring-inset ring-blue-400/20">
                            🐋 WHALE SIGNAL
                        </span>
                        <span className="inline-flex items-center rounded-full bg-gray-800 px-2 py-1 text-xs font-medium text-gray-400 ring-1 ring-inset ring-gray-700">
                            RANK #{signal.tracked_traders?.leaderboard_rank || '?'}
                        </span>
                    </div>
                </div>

                {/* Question */}
                <h3 className="text-lg font-semibold leading-6 text-white min-h-[3rem] line-clamp-2 mb-3">
                    <a href={`https://polymarket.com/event/${signal.market_slug}`} target="_blank" className="hover:text-blue-400 transition-colors">
                        {signal.market_question}
                    </a>
                </h3>

                {/* Main Action */}
                <div className="bg-gray-800/50 rounded-lg p-3 mb-4 flex justify-between items-center">
                    <div>
                        <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">Action</span>
                        <div className={`text-xl font-bold ${signal.trader_action === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
                            {signal.trader_action}
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">Position</span>
                        <div className="text-white font-mono">
                            ${signal.position_size_usd?.toLocaleString()}
                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 text-xs text-gray-400 mb-4 border-t border-gray-800 pt-3">
                    <div>
                        <span className="block text-gray-500">Avg Price</span>
                        <span className="text-white font-medium">{signal.average_buy_price || 'N/A'}</span>
                    </div>
                    <div>
                        <span className="block text-gray-500">Est. Payout</span>
                        <span className="text-green-400 font-medium">
                            ${signal.potential_payout ? Math.round(signal.potential_payout).toLocaleString() : '?'}
                        </span>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs text-gray-600 border-t border-gray-800 pt-3">
                    <div className="flex items-center gap-1">
                        <span className={`h-2 w-2 rounded-full ${isHigh ? 'bg-green-500' : isMedium ? 'bg-yellow-500' : 'bg-gray-500'}`}></span>
                        <span className="capitalize">{signal.signal_strength} Strength</span>
                    </div>
                    <a
                        href={`https://polymarket.com/event/${signal.market_slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:text-white transition-colors"
                    >
                        Copy Bet <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                    </a>
                </div>
            </div>
        </div>
    );
}
