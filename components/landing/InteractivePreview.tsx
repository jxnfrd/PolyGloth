'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Newspaper, TrendingUp, Cpu } from 'lucide-react';

const MOCK_SIGNALS = [
    {
        id: 1,
        type: 'whale',
        title: 'Will Bitcoin hit $100k in 2026?',
        reason: 'Whale 0x72a...99 bought $50k YES shares. Historic win rate 82%.',
        time: '2m ago',
        color: 'border-emerald-500/50'
    },
    {
        id: 2,
        type: 'news',
        title: 'China GDP Growth Q1 > 5%?',
        reason: 'Contradiction: Internal party memo leaked via WeChat suggests 4.2% revisal.',
        time: '5m ago',
        color: 'border-cyan-500/50'
    },
    {
        id: 3,
        type: 'ai',
        title: 'Fed Interest Rate Cut in March?',
        reason: 'Model Confidence 92%: Powell speech analysis indicates hawkish pivot.',
        time: '12m ago',
        color: 'border-purple-500/50'
    }
];

export default function InteractivePreview() {
    const [filter, setFilter] = useState<'all' | 'whale' | 'news' | 'ai'>('all');

    const filteredSignals = MOCK_SIGNALS.filter(s => filter === 'all' || s.type === filter);

    return (
        <section className="bg-gray-950 py-24 relative overflow-hidden">
            <div className="absolute inset-0 bg-gray-900/50 skew-y-3 transform origin-top-left z-0"></div>

            <div className="relative z-10 mx-auto max-w-7xl px-6 lg:px-8">
                <div className="mx-auto max-w-3xl text-center mb-12">
                    <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl mb-4">
                        Your New Trading Terminal
                    </h2>
                    <p className="text-gray-400">
                        Live simulation. Hover/Click filters to see how the engine organizes intelligence.
                    </p>
                </div>

                <div className="mx-auto max-w-5xl rounded-xl border border-gray-800 bg-gray-950/90 shadow-2xl overflow-hidden backdrop-blur-sm">
                    {/* Fake Browser Header */}
                    <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-900 p-3 px-4">
                        <div className="flex gap-1.5">
                            <div className="h-3 w-3 rounded-full bg-red-500/20 border border-red-500/50" />
                            <div className="h-3 w-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                            <div className="h-3 w-3 rounded-full bg-green-500/20 border border-green-500/50" />
                        </div>
                        <div className="ml-4 flex-1 rounded bg-gray-950/50 p-1.5 text-center text-xs font-mono text-gray-500 border border-gray-800/50">
                            pmex.at.eu.org/dashboard
                        </div>
                    </div>

                    {/* Toolbar */}
                    <div className="flex gap-2 border-b border-gray-800 p-4 overflow-x-auto">
                        <button onClick={() => setFilter('all')} className={`px-3 py-1 text-xs font-mono rounded border ${filter === 'all' ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' : 'border-gray-800 text-gray-500 hover:text-white'}`}>ALL_SIGNALS</button>
                        <button onClick={() => setFilter('whale')} className={`px-3 py-1 text-xs font-mono rounded border ${filter === 'whale' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'border-gray-800 text-gray-500 hover:text-white'}`}>WHALES</button>
                        <button onClick={() => setFilter('news')} className={`px-3 py-1 text-xs font-mono rounded border ${filter === 'news' ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400' : 'border-gray-800 text-gray-500 hover:text-white'}`}>NEWS_SENTIMENT</button>
                        <button onClick={() => setFilter('ai')} className={`px-3 py-1 text-xs font-mono rounded border ${filter === 'ai' ? 'bg-purple-500/20 border-purple-500 text-purple-400' : 'border-gray-800 text-gray-500 hover:text-white'}`}>AI_REASONING</button>
                    </div>

                    {/* Content Area */}
                    <div className="p-6 min-h-[400px] bg-gray-950 relative">
                        {/* Grid Background */}
                        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px]"></div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative z-10">
                            <AnimatePresence mode="popLayout">
                                {filteredSignals.map((signal) => (
                                    <motion.div
                                        layout
                                        key={signal.id}
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        transition={{ duration: 0.2 }}
                                        className={`rounded-lg border bg-gray-900 p-4 ${signal.color} border-l-4 shadow-lg`}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            {signal.type === 'whale' && <TrendingUp className="h-5 w-5 text-emerald-400" />}
                                            {signal.type === 'news' && <Newspaper className="h-5 w-5 text-cyan-400" />}
                                            {signal.type === 'ai' && <Cpu className="h-5 w-5 text-purple-400" />}
                                            <span className="text-[10px] font-mono text-gray-500">{signal.time}</span>
                                        </div>
                                        <h4 className="text-sm font-medium text-white mb-2">{signal.title}</h4>
                                        <p className="text-xs text-gray-400">{signal.reason}</p>

                                        <div className="mt-3 flex gap-2">
                                            <div className="h-1.5 flex-1 bg-gray-800 rounded-full overflow-hidden">
                                                <div className="h-full bg-gray-600 w-2/3"></div>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
