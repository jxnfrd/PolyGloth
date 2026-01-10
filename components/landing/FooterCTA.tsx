'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function FooterCTA() {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    // Fake submission for visuals
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus('loading');
        // Simulate API call
        setTimeout(() => setStatus('success'), 1500);
    };

    return (
        <footer className="bg-gray-950 border-t border-gray-900 pt-24 pb-12">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="rounded-3xl bg-gray-900 py-16 px-6 sm:py-24 sm:px-12 lg:px-16 border border-gray-800 relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-cyan-500/10"></div>

                    <div className="relative z-10 mx-auto max-w-2xl text-center">
                        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                            Stop Scrolling. Start Trading Smarter.
                        </h2>
                        <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-gray-400">
                            Join the waitlist for early access. First 100 users get a lifetime discount.
                        </p>
                        <form onSubmit={handleSubmit} className="mt-10 max-w-md mx-auto flex gap-x-4">
                            <label htmlFor="email-address" className="sr-only">Email address</label>
                            <input
                                id="email-address"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="min-w-0 flex-auto rounded-md border-0 bg-white/5 px-3.5 py-2 text-white shadow-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-inset focus:ring-cyan-500 sm:text-sm sm:leading-6 placeholder:text-gray-500"
                                placeholder="Enter your email"
                            />
                            <button
                                type="submit"
                                disabled={status === 'loading' || status === 'success'}
                                className="flex-none rounded-md bg-cyan-500 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {status === 'loading' ? 'Securing...' : status === 'success' ? 'Spot Secured' : 'Secure My Spot'}
                            </button>
                        </form>
                        {status === 'success' && (
                            <p className="mt-4 text-sm text-emerald-400 animate-fade-in">
                                🔒 You are on the list. We'll be in touch.
                            </p>
                        )}
                    </div>
                </div>

                <div className="mt-16 flex flex-col md:flex-row justify-between items-center gap-6 border-t border-gray-900 pt-8">
                    <p className="text-xs leading-5 text-gray-500">
                        &copy; 2026 PolyGloth Intelligence. All rights reserved.
                    </p>

                    <div className="flex items-center gap-2 text-xs font-mono text-gray-600 bg-gray-900 px-3 py-1 rounded">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        12,847 MARKETS ANALYZED
                    </div>

                    <div className="flex space-x-6 text-sm text-gray-400">
                        <Link href="#" className="hover:text-white">Privacy</Link>
                        <Link href="#" className="hover:text-white">Terms</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
