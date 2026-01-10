'use client';

import { useState } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import DeleteSignalButton from './DeleteSignalButton';

interface Signal {
    id: string;
    market_title: string;
    market_slug: string;
    tier: number;
    contradiction_score: number;
    evidence_type: string;
    article_url: string;
    source_outlet?: string;
    freshness_score?: number;
}

export default function AdminSignalsTable({ initialSignals }: { initialSignals: Signal[] }) {
    const [strictMode, setStrictMode] = useState(true);

    const filteredSignals = initialSignals.filter(s => {
        if (strictMode) {
            // Show only Tier 1 (Gov) and Tier 2 (Crisis/High Confidence)
            // Hide Tier 3 (Standard News)
            return s.tier < 3;
        }
        return true;
    });

    return (
        <div>
            {/* Controls */}
            <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-3">
                    <label className="flex items-center cursor-pointer">
                        <div className="relative">
                            <input
                                type="checkbox"
                                className="sr-only"
                                checked={strictMode}
                                onChange={() => setStrictMode(!strictMode)}
                            />
                            <div className={`block w-10 h-6 rounded-full transition-colors ${strictMode ? 'bg-indigo-600' : 'bg-gray-600'}`}></div>
                            <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${strictMode ? 'transform translate-x-4' : ''}`}></div>
                        </div>
                        <div className="ml-3 text-sm font-medium text-gray-300">
                            Strict Mode {strictMode ? '(High Quality Only)' : '(Show All)'}
                        </div>
                    </label>
                </div>
                <span className="text-xs text-gray-500">
                    Showing {filteredSignals.length} of {initialSignals.length} signals
                </span>
            </div>

            <div className="overflow-hidden bg-gray-900 shadow ring-1 ring-white/10 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-800">
                    <thead className="bg-gray-800">
                        <tr>
                            <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-white sm:pl-6">Market</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Tier</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Score</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Evidence / Freshness</th>
                            <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                                <span className="sr-only">Actions</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {filteredSignals.length > 0 ? (
                            filteredSignals.map((signal) => (
                                <tr key={signal.id} className="hover:bg-gray-800/50">
                                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-white sm:pl-6">
                                        <a
                                            href={signal.market_slug
                                                ? `https://polymarket.com/event/${signal.market_slug}`
                                                : `https://polymarket.com/markets?q=${encodeURIComponent(signal.market_title)}`
                                            }
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:text-indigo-400 transition-colors flex items-center gap-2"
                                        >
                                            {signal.market_title.substring(0, 40)}...
                                            <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-500" />
                                        </a>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${signal.tier === 1 ? 'bg-indigo-400/10 text-indigo-400 ring-indigo-400/20' :
                                                signal.tier === 2 ? 'bg-yellow-400/10 text-yellow-400 ring-yellow-400/20' :
                                                    'bg-gray-400/10 text-gray-400 ring-gray-400/20'
                                            }`}>
                                            Tier {signal.tier || 3}
                                        </span>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                                        {signal.contradiction_score}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                                        <a
                                            href={signal.article_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="group flex flex-col hover:text-indigo-400 transition-colors"
                                        >
                                            <span className="block font-medium">{signal.evidence_type}</span>
                                            {signal.source_outlet && (
                                                <span className="text-xs text-gray-500 group-hover:text-indigo-300 truncate max-w-[150px]">
                                                    {signal.source_outlet}
                                                </span>
                                            )}
                                            {/* @ts-ignore */}
                                            {signal.freshness_score && <span className="text-xs text-green-400 mt-0.5">Fresh: {signal.freshness_score}</span>}
                                        </a>
                                    </td>
                                    <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                                        <div className="flex justify-end gap-3 items-center">
                                            <a href={`/dashboard`} className="text-indigo-400 hover:text-indigo-300 text-xs">View on Dash</a>
                                            <DeleteSignalButton signalId={signal.id} />
                                        </div>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={5} className="py-8 text-center text-gray-500">
                                    No signals found in this mode. {strictMode && 'Try disabling Strict Mode.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
