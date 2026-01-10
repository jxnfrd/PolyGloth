'use client';

import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function AdminWhalesTable({ whales }: { whales: any[] }) {
    if (!whales || whales.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                No tracked whale signals yet. Run the scan script!
            </div>
        );
    }

    return (
        <div className="overflow-hidden bg-gray-900 shadow ring-1 ring-white/10 sm:rounded-lg">
            <table className="min-w-full divide-y divide-gray-800">
                <thead className="bg-gray-800">
                    <tr>
                        <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-white sm:pl-6">Trader (Rank)</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Market / Action</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Size / Price</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Strength</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Discovered</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                    {whales.map((signal) => (
                        <tr key={signal.id} className="hover:bg-gray-800/50">
                            <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-white sm:pl-6">
                                <span className="block text-indigo-400 font-mono">
                                    {signal.tracked_traders?.polymarket_user_id || 'Unknown'}
                                </span>
                                <span className="inline-flex items-center rounded-md bg-gray-700/50 px-2 py-1 text-xs font-medium text-gray-300 mt-1">
                                    Rank #{signal.tracked_traders?.leaderboard_rank}
                                </span>
                            </td>
                            <td className="px-3 py-4 text-sm text-gray-300 max-w-xs">
                                <a
                                    href={`https://polymarket.com/event/${signal.market_slug}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-blue-400 transition-colors flex items-center gap-2 font-medium text-white mb-1"
                                >
                                    <span className="truncate block max-w-[200px]">{signal.market_question}</span>
                                    <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-500" />
                                </a>
                                <div className="text-xs">
                                    Action: <span className={signal.trader_action === 'YES' ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                                        {signal.trader_action}
                                    </span>
                                </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                                <div className="text-white font-bold">${signal.position_size_usd?.toLocaleString()}</div>
                                <div className="text-xs text-gray-500">@ {signal.average_buy_price}</div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm">
                                <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${signal.signal_strength === 'high' ? 'bg-green-400/10 text-green-400 ring-green-400/20' :
                                        signal.signal_strength === 'medium' ? 'bg-yellow-400/10 text-yellow-400 ring-yellow-400/20' :
                                            'bg-gray-400/10 text-gray-400 ring-gray-400/20'
                                    }`}>
                                    {signal.signal_strength?.toUpperCase()}
                                </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-xs text-gray-500">
                                {new Date(signal.discovered_at).toLocaleString()}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
