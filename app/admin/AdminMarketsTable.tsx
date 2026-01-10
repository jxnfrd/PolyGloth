'use client';

import { useState, useEffect } from 'react';
import { getActiveMarketsForAdmin } from '@/app/actions/fetch-markets';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

export default function AdminMarketsTable() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [markets, setMarkets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadMarkets();
    }, []);

    const loadMarkets = async () => {
        setLoading(true);
        const { success, data } = await getActiveMarketsForAdmin();
        if (success && data) {
            setMarkets(data);
        }
        setLoading(false);
    };

    return (
        <div className="mt-8">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-white">Live Polymarket Feed (Raw)</h3>
                <button
                    onClick={loadMarkets}
                    className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
                >
                    Refresh
                </button>
            </div>

            <div className="overflow-hidden bg-gray-900 shadow ring-1 ring-white/10 sm:rounded-lg">
                {loading ? (
                    <div className="p-8 text-center text-gray-400">Loading live markets...</div>
                ) : (
                    <table className="min-w-full divide-y divide-gray-800">
                        <thead className="bg-gray-800">
                            <tr>
                                <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-white sm:pl-6">Question</th>
                                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Volume</th>
                                <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">End Date</th>
                                <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                                    <span className="sr-only">Link</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {markets.map((market) => (
                                <tr key={market.id} className="hover:bg-gray-800/50">
                                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-white sm:pl-6">
                                        {market.question}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                                        ${Number(market.volume).toLocaleString()}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                                        {market.endDate ? new Date(market.endDate).toLocaleDateString() : 'N/A'}
                                    </td>
                                    <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                                        <a
                                            href={market.slug ? `https://polymarket.com/event/${market.slug}` : `https://polymarket.com/market/${market.id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
                                        >
                                            View <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                                        </a>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            <p className="mt-2 text-xs text-gray-500 text-right">
                Showing top 50 active markets from Gamma API.
            </p>
        </div>
    );
}
