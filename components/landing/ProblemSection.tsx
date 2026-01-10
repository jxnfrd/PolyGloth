'use client';

import { AlertTriangle, TrendingDown, Clock, Globe } from 'lucide-react';

const problems = [
    {
        title: 'Lost in Translation',
        description: 'You miss the winning trade because the breaking news was in Portuguese, Japanese, or Arabic.',
        icon: Globe,
    },
    {
        title: 'Late to the Party',
        description: 'By the time you see it on Twitter, the whales have already positioned and the odds have crushed.',
        icon: Clock,
    },
    {
        title: 'Following the Herd',
        description: 'You rely on public sentiment and "expert" takes, getting rekt when the market reverses.',
        icon: TrendingDown,
    },
];

export default function ProblemSection() {
    return (
        <section className="bg-gray-950 py-24 sm:py-32 border-t border-gray-900">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="mx-auto max-w-2xl text-center">
                    <h2 className="text-base font-semibold leading-7 text-rose-500">The Reality</h2>
                    <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                        Tired of Guessing?
                    </p>
                    <p className="mt-6 text-lg leading-8 text-gray-400">
                        The market is inefficient, but human speed is the bottleneck. You are competing against algorithms and insiders.
                    </p>
                </div>
                <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
                    <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-3">
                        {problems.map((problem) => (
                            <div key={problem.title} className="flex flex-col items-start bg-gray-900/40 p-8 rounded-2xl border border-gray-800 hover:border-gray-700 transition-colors">
                                <div className="rounded-lg bg-gray-900 p-2 ring-1 ring-white/10 mb-6">
                                    <problem.icon className="h-6 w-6 text-rose-400" aria-hidden="true" />
                                </div>
                                <dt className="text-base font-semibold leading-7 text-white">
                                    {problem.title}
                                </dt>
                                <dd className="mt-1 text-base leading-7 text-gray-400">
                                    {problem.description}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>
        </section>
    );
}
