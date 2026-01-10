import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface AdminStats {
    total_signals: number;
    active_users: number;
    avg_score: number;
    polymarket_clicks: number;
}

interface Signal {
    id: string;
    market_title: string;
    tier: number;
    contradiction_score: number;
    evidence_type: string;
}

export default async function AdminDashboard() {
    const supabase = await createClient();

    // 1. Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return redirect('/signin');
    }

    // 2. Fetch Analytics (with manual typing since View types aren't generated yet)
    const { data: statsRaw, error } = await supabase.from('admin_dashboard').select('*').limit(1);
    const stats = statsRaw as unknown as AdminStats[];

    const { data: signalsRaw } = await supabase.from('contrarian_signals').select('*').order('created_at', { ascending: false }).limit(20);
    const signals = signalsRaw as unknown as Signal[];

    if (error) {
        console.error('Admin fetch error:', error);
    }

    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
            <div className="md:flex md:items-center md:justify-between mb-8">
                <div className="min-w-0 flex-1">
                    <h2 className="text-2xl font-bold leading-7 text-white sm:truncate sm:text-3xl sm:tracking-tight">
                        Admin Command Center
                    </h2>
                    <p className="mt-1 text-sm text-gray-400">
                        System health, user activity, and signal performance.
                    </p>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-4 mb-10">
                <div className="overflow-hidden rounded-lg bg-gray-900 px-4 py-5 shadow sm:p-6 ring-1 ring-white/10">
                    <dt className="truncate text-sm font-medium text-gray-400">Total Signals</dt>
                    <dd className="mt-1 text-3xl font-semibold tracking-tight text-white">
                        {stats?.[0]?.total_signals || 0}
                    </dd>
                </div>
                <div className="overflow-hidden rounded-lg bg-gray-900 px-4 py-5 shadow sm:p-6 ring-1 ring-white/10">
                    <dt className="truncate text-sm font-medium text-gray-400">Active Users (24h)</dt>
                    <dd className="mt-1 text-3xl font-semibold tracking-tight text-white">
                        {stats?.[0]?.active_users || 0}
                    </dd>
                </div>
                <div className="overflow-hidden rounded-lg bg-gray-900 px-4 py-5 shadow sm:p-6 ring-1 ring-white/10">
                    <dt className="truncate text-sm font-medium text-gray-400">Avg Contradiction Score</dt>
                    <dd className="mt-1 text-3xl font-semibold tracking-tight text-indigo-400">
                        {Math.round(stats?.[0]?.avg_score || 0)}%
                    </dd>
                </div>
                <div className="overflow-hidden rounded-lg bg-gray-900 px-4 py-5 shadow sm:p-6 ring-1 ring-white/10">
                    <dt className="truncate text-sm font-medium text-gray-400">Polymarket Clicks</dt>
                    <dd className="mt-1 text-3xl font-semibold tracking-tight text-green-400">
                        {stats?.[0]?.polymarket_clicks || 0}
                    </dd>
                </div>
            </div>

            {/* Recent Signals Table */}
            <h3 className="text-lg font-semibold leading-6 text-white mb-4">Live Processing Log</h3>
            <div className="overflow-hidden bg-gray-900 shadow ring-1 ring-white/10 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-800">
                    <thead className="bg-gray-800">
                        <tr>
                            <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-white sm:pl-6">Market</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Tier</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Score</th>
                            <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Evidence</th>
                            <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                                <span className="sr-only">Actions</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {signals?.map((signal) => (
                            <tr key={signal.id} className="hover:bg-gray-800/50">
                                <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-white sm:pl-6">
                                    {signal.market_title.substring(0, 40)}...
                                </td>
                                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                                    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${signal.tier === 1 ? 'bg-indigo-400/10 text-indigo-400 ring-indigo-400/20' :
                                        'bg-gray-400/10 text-gray-400 ring-gray-400/20'
                                        }`}>
                                        Tier {signal.tier || 3}
                                    </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                                    {signal.contradiction_score}
                                </td>
                                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-300">
                                    {signal.evidence_type}
                                </td>
                                <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                                    <a href={`/dashboard`} className="text-indigo-400 hover:text-indigo-300">View</a>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
