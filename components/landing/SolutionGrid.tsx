'use client';

import { motion } from 'framer-motion';
import { Newspaper, Brain, CheckCircle, BarChart3 } from 'lucide-react';

const solutions = [
    {
        id: 'whales',
        title: 'Whale Tracking',
        description: 'We track the top 20 Polymarket leaders. When they move size, you get alerted instantly. Copy conviction.',
        icon: BarChart3,
        color: 'text-emerald-400',
        borderColor: 'border-emerald-900',
        visual: (
            <div className="w-full h-32 bg-gray-900 rounded-lg p-3 space-y-2 border border-gray-800 font-mono text-xs">
                <div className="flex justify-between text-gray-500 border-b border-gray-800 pb-1"><span>Trader</span><span>Profit</span></div>
                <div className="flex justify-between text-emerald-400"><span>0x7a...9f</span><span>+$142k</span></div>
                <div className="flex justify-between text-emerald-500"><span>0x3b...2c</span><span>+$98k</span></div>
                <div className="flex justify-between text-white"><span>0x1a...eed</span><span>+$12k</span></div>
                <div className="flex justify-between text-gray-400"><span>0x9c...11</span><span>+$4k</span></div>
            </div>
        )
    },
    {
        id: 'news',
        title: 'News Arbitrage',
        description: 'Scans 100+ languages using GDELT. Finds sentiment contradictions before English media translates them.',
        icon: Newspaper,
        color: 'text-cyan-400',
        borderColor: 'border-cyan-900',
        visual: (
            <div className="w-full h-32 bg-gray-900 rounded-lg p-2 border border-gray-800 font-mono text-[10px] overflow-hidden relative">
                <div className="absolute top-2 right-2 animate-pulse w-2 h-2 rounded-full bg-cyan-500"></div>
                <div className="text-gray-500 mb-1">Incoming Feed...</div>
                <div className="text-cyan-300 truncate">🇧🇷 [PT] Petrobras confirma descoberta...</div>
                <div className="text-gray-400 truncate">🇯🇵 [JP] Toyota announces battery break...</div>
                <div className="text-gray-400 truncate">🇩🇪 [DE] Scholz lehnt Lieferung ab...</div>
                <div className="text-cyan-300 truncate">🇫🇷 [FR] TotalEnergies investit dans...</div>
            </div>
        )
    },
    {
        id: 'ai',
        title: 'Pure AI Predictions',
        description: 'Gemini 2.0 Flash Thinking analyzes markets with full chain-of-thought reasoning. No bias, just probability.',
        icon: Brain,
        color: 'text-purple-400',
        borderColor: 'border-purple-900',
        visual: (
            <div className="w-full h-32 bg-gray-900 rounded-lg p-3 border border-gray-800 font-mono text-[10px]">
                <div className="flex items-center gap-2 mb-2">
                    <div className="w-4 h-4 rounded bg-purple-500/20 flex items-center justify-center text-purple-400">AI</div>
                    <span className="text-gray-400">Analysis: FDA Approval</span>
                </div>
                <div className="text-gray-300">Confidence: <span className="text-emerald-400">High (85%)</span></div>
                <div className="text-gray-500 mt-1">"Clinical trial data shows p-value &lt; 0.05. Historic approval rate for this drug class is 90%..."</div>
            </div>
        )
    },
    {
        id: 'orchestrator',
        title: 'Deterministic Core',
        description: 'Every signal is validated. No hallucinations. The Orchestrator State Machine ensures enterprise-grade reliability.',
        icon: CheckCircle,
        color: 'text-orange-400',
        borderColor: 'border-orange-900',
        visual: (
            <div className="w-full h-32 bg-gray-900 rounded-lg flex items-center justify-center border border-gray-800 relative">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded border border-gray-700 bg-gray-800 flex items-center justify-center text-xs text-gray-400">SRC</div>
                    <div className="w-4 h-0.5 bg-gray-700"></div>
                    <div className="w-8 h-8 rounded border border-orange-900 bg-orange-500/10 flex items-center justify-center text-xs text-orange-400 animate-pulse">AI</div>
                    <div className="w-4 h-0.5 bg-gray-700"></div>
                    <div className="w-8 h-8 rounded border border-gray-700 bg-gray-800 flex items-center justify-center text-xs text-emerald-400">SIG</div>
                </div>
            </div>
        )
    }
];

export default function SolutionGrid() {
    return (
        <section id="features" className="bg-gray-950 py-24 sm:py-32">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="mx-auto max-w-2xl lg:text-center mb-16">
                    <h2 className="text-base font-semibold leading-7 text-cyan-400">The Technology</h2>
                    <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                        Four-Layer Intelligence Engine
                    </p>
                    <p className="mt-6 text-lg leading-8 text-gray-400">
                        We don't just "guess". We systematically dismantle information asymmetry using four distinct layers of analysis.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:gap-12">
                    {solutions.map((item, idx) => (
                        <motion.div
                            key={item.id}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: idx * 0.1 }}
                            className={`relative overflow-hidden rounded-2xl bg-gray-900/50 p-6 ring-1 ring-inset ring-gray-800 hover:ring-2 hover:ring-opacity-50 ${item.borderColor} transition-all`}
                        >
                            <div className="flex items-center gap-x-4 mb-4">
                                <div className={`rounded-lg bg-gray-950 p-2 ring-1 ring-white/10 ${item.color}`}>
                                    <item.icon className="h-6 w-6" aria-hidden="true" />
                                </div>
                                <h3 className="text-lg font-semibold leading-8 text-white">
                                    {item.title}
                                </h3>
                            </div>
                            <p className="text-base leading-7 text-gray-400 mb-6">
                                {item.description}
                            </p>

                            {/* Visual Placeholder */}
                            <div className="mt-auto">
                                {item.visual}
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
