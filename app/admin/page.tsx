import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import AdminClientView from './AdminClientView';

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

            {/* Main Content Areas with Tabs */}
            <AdminClientView signals={signals || []} logs={logs || []} />
        </div>
    );
}
