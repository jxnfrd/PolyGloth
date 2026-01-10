'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, PlayCircle } from 'lucide-react';

export default function Hero() {
    return (
        <section className="relative overflow-hidden bg-gray-950 pt-20 pb-32 lg:pt-32 lg:pb-40">
            {/* Background Effects */}
            <div className="absolute inset-0 z-0 opacity-20">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
                <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-cyan-500 opacity-20 blur-[100px]"></div>
            </div>

            <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                >
                    <span className="inline-block rounded-full bg-gray-900 px-4 py-1.5 text-sm font-medium text-cyan-400 border border-gray-800 mb-6">
                        🚀 Public Beta Access Live
                    </span>
                    <h1 className="mx-auto max-w-4xl font-display text-5xl font-medium tracking-tight text-white sm:text-7xl">
                        Trade With an <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">Unfair Advantage</span>
                    </h1>
                    <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-400">
                        PolyGloth Intelligence scans global news, tracks top traders, and leverages AI to find high-confidence signals on Polymarket—before the market moves.
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                    className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
                >
                    <Link
                        href="/dashboard"
                        className="group inline-flex items-center justify-center rounded-lg bg-cyan-500 px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-gray-900"
                    >
                        Get Early Access
                        <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                    <Link
                        href="#features"
                        className="inline-flex items-center justify-center rounded-lg border border-gray-700 bg-gray-900/50 px-8 py-3 text-sm font-medium text-gray-300 backdrop-blur-sm transition-colors hover:bg-gray-800 hover:text-white"
                    >
                        <PlayCircle className="mr-2 h-4 w-4" />
                        See How It Works
                    </Link>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 1, delay: 0.5 }}
                    className="mt-8 text-sm text-gray-500"
                >
                    Trusted by the most profitable Polymarket traders
                </motion.div>

                {/* Dashboard Mockup Container */}
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.4 }}
                    className="mt-20 relative mx-auto max-w-5xl rounded-xl border border-gray-800 bg-gray-900/50 p-2 shadow-2xl backdrop-blur-xl"
                >
                    <div className="absolute -inset-1 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 opacity-20 blur"></div>
                    <div className="relative rounded-lg bg-gray-950 overflow-hidden aspect-[16/9] flex items-center justify-center border border-gray-800">
                        <p className="text-gray-600 font-mono text-sm">[Interactive Dashboard Mockup Payload Loading...]</p>
                        {/* We will replace this with the InteractivePreview component later */}
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
