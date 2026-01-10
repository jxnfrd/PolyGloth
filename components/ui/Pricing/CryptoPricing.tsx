'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button'; // Assuming export default from index or Button
// Check if Button is exported as default or named. Usually default in starter kits.
// Based on file list: components/ui/Button/Button.tsx and index.ts. index.ts likely exports Button.

import { User } from '@supabase/supabase-js';

export default function CryptoPricing({
    user
}: {
    user: User | null;
}) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const handleSubscribe = async () => {
        if (!user) {
            router.push('/signin');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch('/api/create-invoice', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ planType: 'monthly' })
            });

            if (!response.ok) {
                throw new Error('Failed to create invoice');
            }

            const data = await response.json();
            if (data.checkoutLink) {
                window.location.href = data.checkoutLink;
            } else {
                console.error('No checkout link returned');
            }
        } catch (error) {
            console.error('Error handling subscription:', error);
            alert('Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className="bg-black py-24 sm:py-32">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="mx-auto max-w-2xl sm:text-center">
                    <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                        PolyGlot Intelligence Pricing
                    </h2>
                    <p className="mt-6 text-lg leading-8 text-gray-300">
                        Unlock the power of global news and prediction markets with our Intelligence Engine.
                    </p>
                </div>
                <div className="mx-auto mt-16 max-w-2xl rounded-3xl ring-1 ring-gray-700 sm:mt-20 lg:mx-0 lg:flex lg:max-w-none">
                    <div className="p-8 sm:p-10 lg:flex-auto">
                        <h3 className="text-2xl font-bold tracking-tight text-white">Monthly Access</h3>
                        <p className="mt-6 text-base leading-7 text-gray-300">
                            Get full access to all features including GDELT news analysis, Polymarket signals, and Gemini-powered insights.
                        </p>
                        <div className="mt-10 flex items-center gap-x-4">
                            <h4 className="flex-none text-sm font-semibold leading-6 text-indigo-400">What’s included</h4>
                            <div className="h-px flex-auto bg-gray-700" />
                        </div>
                        <ul role="list" className="mt-8 grid grid-cols-1 gap-4 text-sm leading-6 text-gray-300 sm:grid-cols-2 sm:gap-6">
                            {[
                                'Real-time Non-English News',
                                'Prediction Market Signals',
                                'AI Contrarian Analysis',
                                'Crypto Payments'
                            ].map((feature) => (
                                <li key={feature} className="flex gap-x-3">
                                    <svg className="h-6 w-5 flex-none text-indigo-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                    </svg>
                                    {feature}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="-mt-2 p-2 lg:mt-0 lg:w-full lg:max-w-md lg:flex-shrink-0">
                        <div className="rounded-2xl bg-gray-900 py-10 text-center ring-1 ring-inset ring-gray-900/5 lg:flex lg:flex-col lg:justify-center lg:py-16">
                            <div className="mx-auto max-w-xs px-8">
                                <p className="text-base font-semibold text-gray-400">Pay with Crypto</p>
                                <p className="mt-6 flex items-baseline justify-center gap-x-2">
                                    <span className="text-5xl font-bold tracking-tight text-white">$29</span>
                                    <span className="text-sm font-semibold leading-6 text-gray-400">/month</span>
                                </p>
                                <div className="mt-10">
                                    <Button
                                        variant="slim"
                                        type="button"
                                        disabled={loading}
                                        onClick={handleSubscribe}
                                        className="block w-full rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                                    >
                                        {loading ? 'Processing...' : 'Buy Monthly Access'}
                                    </Button>
                                </div>
                                <p className="mt-6 text-xs leading-5 text-gray-400">
                                    Invoices generated via Bitcart.ai.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
