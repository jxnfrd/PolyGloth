'use client';

import { useState } from 'react';
import PureAIPredictionCard from '@/components/PureAIPredictionCard';

// Reuse existing card structure for standard signals or import if componentized
// For now, I'll inline the logic or assume standard row
// To keep it clean, let's copy the card UI from the original page.tsx into a helper here
// or just inline it since it was inline before.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DashboardClientView({ signals, predictions }: { signals: any[], predictions: any[] }) {
    const [filter, setFilter] = useState<'all' | 'news' | 'ai'>('all');

    return (
        <div>
            {/* Filter Toggle */}
            <div className="flex justify-center mb-10">
                <div className="bg-gray-900 p-1 rounded-lg inline-flex ring-1 ring-white/10">
                    <button
                        onClick={() => setFilter('all')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${filter === 'all' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                    >
                        All Signals
                    </button>
                    <button
                        onClick={() => setFilter('news')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${filter === 'news' ? 'bg-indigo-900/50 text-indigo-400 shadow-sm' : 'text-gray-400 hover:text-white'}`}
                    >
                        📰 News Monitor
                    </button>
                    <button
                        onClick={() => setFilter('ai')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${filter === 'ai' ? 'bg-purple-900/50 text-purple-400 shadow-sm' : 'text-gray-400 hover:text-white'}`}
                    >
                        ✨ Pure AI
                    </button>
                </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {/* 1. News Signals */}
                {(filter === 'all' || filter === 'news') && signals.map((signal) => (
                    <div key={signal.id} className="overflow-hidden rounded-xl bg-gray-900 ring-1 ring-white/10 hover:ring-indigo-500/50 transition-all duration-300 relative">
                        {/* News Signal Card Content (Copied from original page.tsx) */}
                        <div className="p-6">
                            <div className="flex items-center justify-between gap-x-4 mb-4">
                                <div className="flex items-center gap-2">
                                    <div className={`h-3 w-3 rounded-full ${signal.indicator_color === 'green' ? 'bg-green-500 animate-pulse' :
                                        signal.indicator_color === 'orange' ? 'bg-orange-500' :
                                            'bg-red-500'
                                        }`} title={`Freshness Score: ${signal.freshness_score || 'N/A'}`} />

                                    <div className={`rounded-md px-2 py-1 text-xs font-bold ring-1 ring-inset ${signal.tier === 1 ? 'bg-indigo-400/10 text-indigo-400 ring-indigo-400/20' :
                                        signal.tier === 2 ? 'bg-blue-400/10 text-blue-400 ring-blue-400/20' :
                                            'bg-gray-400/10 text-gray-400 ring-gray-400/20'
                                        }`}>
                                        TIER {signal.tier || '3'}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    {signal.time_advantage_hours > 0 && (
                                        <div className="rounded-md bg-green-400/10 px-2 py-1 text-xs font-medium text-green-400 ring-1 ring-inset ring-green-400/20">
                                            {signal.time_advantage_hours}h Adv
                                        </div>
                                    )}
                                </div>
                            </div>

                            <h3 className="text-lg font-semibold leading-6 text-white min-h-[3rem] line-clamp-2">
                                <a href={`/api/track/click?signal_id=${signal.id}&slug=${signal.market_slug}`} target="_blank" className="hover:text-indigo-400 transition-colors">
                                    {signal.market_title}
                                </a>
                            </h3>

                            <p className="mt-4 text-sm leading-6 text-gray-300 line-clamp-3 italic">
                                "{signal.key_finding}"
                            </p>

                            <div className="mt-4 flex flex-wrap gap-2">
                                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${signal.evidence_type === 'OFFICIAL_DOCUMENT'
                                    ? 'bg-purple-400/10 text-purple-400 ring-purple-400/20'
                                    : 'bg-blue-400/10 text-blue-400 ring-blue-400/20'
                                    }`}>
                                    {signal.evidence_type === 'OFFICIAL_DOCUMENT' ? '🏛️ OFFICIAL GOV' : '📰 NEWS MEDIA'}
                                </span>
                                <span className="inline-flex items-center rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-300">
                                    Score: {signal.contradiction_score}/100
                                </span>
                            </div>

                            <div className="mt-6 border-t border-gray-800 pt-6 flex justify-between items-center">
                                <div className="text-xs text-gray-500 max-w-[50%] truncate">
                                    Src: <a href={signal.article_url} target="_blank" className="hover:text-indigo-400 underline decoration-gray-700 underline-offset-2">
                                        {new URL(signal.article_url).hostname.replace('www.', '')}
                                    </a>
                                </div>

                                <a
                                    href={`/api/track/click?signal_id=${signal.id}&slug=${signal.market_slug}`}
                                    target="_blank"
                                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                                >
                                    View Market &rarr;
                                </a>
                            </div>
                        </div>
                    </div>
                ))}

                {/* 2. Pure AI Predictions */}
                {(filter === 'all' || filter === 'ai') && predictions.map((pred) => (
                    <PureAIPredictionCard key={pred.id} prediction={pred} />
                ))}

                {/* Empty State */}
                {((filter === 'news' && signals.length === 0) || (filter === 'ai' && predictions.length === 0)) && (
                    <div className="col-span-full text-center text-gray-500 py-10">
                        No {filter === 'news' ? 'news signals' : 'AI predictions'} found.
                    </div>
                )}
            </div>
        </div>
    );
}
