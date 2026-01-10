import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import AdminLogsClient from './AdminLogsClient';
import DeleteSignalButton from './DeleteSignalButton';

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
    market_slug: string; // Added for linking
    tier: number;
    contradiction_score: number;
    evidence_type: string;
    article_url: string; // Added for linking
    source_outlet?: string; // Added for display
    freshness_score?: number;
}

export default async function AdminDashboard() {
    const supabase = await createClient();

    // 1. Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return redirect('/signin');
    }

    // 2. Fetch Analytics
    const { data: statsRaw, error } = await supabase.from('admin_dashboard').select('*').limit(1);
    const stats = statsRaw as unknown as AdminStats[];

    // 3. Fetch Signals
    const { data: signalsRaw } = await supabase.from('contrarian_signals').select('*').order('created_at', { ascending: false }).limit(20);
    const signals = signalsRaw as unknown as Signal[];

    // 4. Fetch Logs for Filtering
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: logs } = await supabase.from('processing_logs' as any).select('*').order('created_at', { ascending: false }).limit(100);

    if (error) {
        console.error('Admin fetch error:', error);
    }

    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
            <div className="md:flex md:items-center md:justify-between mb-8">
                <div className="min-w-0 flex-1">
                    <h2 className="text-2xl font-bold leading-7 text-white sm:truncate sm:text-3xl sm:tracking-tight">
                        Admin Command Center (V2)
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
            {/* Live Processing Logs */}
            <h3 className="text-lg font-semibold leading-6 text-white mb-4 mt-10">System Processing Logs (Real-time)</h3>
            <div className="overflow-hidden bg-gray-900 shadow ring-1 ring-white/10 sm:rounded-lg mb-10">
                <AdminLogsClient initialLogs={logs || []} />
            </div>

            {/* Recent Signals Table */}
            <h3 className="text-lg font-semibold leading-6 text-white mb-4">Latest Signals</h3>
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
                        {signals?.map((signal) => (
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
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
