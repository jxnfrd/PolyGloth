import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import DashboardClientView from './DashboardClientView';

export const dynamic = 'force-dynamic';

/**
 * Audit 2026-09-25: /dashboard was reachable without login while the landing page sells
 * "$49/month access". It now requires a session. A subscription check is still missing
 * because no payment webhook exists (see HANDOVER.md).
 */
export default async function Dashboard({ searchParams }: { searchParams: { view?: string } }) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    // DASHBOARD_PUBLIC=true is for local review only; never set it in production.
    if (!user && process.env.DASHBOARD_PUBLIC !== 'true') return redirect('/signin');

    const view = searchParams?.view || 'all';
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [{ data: signals }, { data: predictions }, { data: whales }] = await Promise.all([
        // Rows before the 2026-09-25 rebuild were seeded/forced test data; never show them.
        supabase.from('contrarian_signals').select('*').eq('status', 'ACTIVE').gte('created_at', '2026-09-25T00:00:00Z').order('created_at', { ascending: false }).limit(60),
        supabase.from('pure_ai_predictions').select('*').order('analysis_timestamp', { ascending: false }).limit(60),
        supabase.from('whale_signals')
            .select('*, tracked_traders ( leaderboard_rank, display_name, total_profit )')
            .like('market_id', '0x%')                        // v2 rows key on conditionId; v1 placeholder rows used slugs
            .gte('discovered_at', sevenDaysAgo)
            .order('position_size_usd', { ascending: false })
            .limit(90)
    ]);

    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-white">PolyGloth Dashboard</h1>
            <p className="mt-2 text-sm text-gray-400">News evidence, AI estimates and leaderboard positions. Every card shows the market price it was generated against.</p>
            <div className="mt-8">
                <DashboardClientView signals={signals || []} predictions={predictions || []} whales={whales || []} initialFilter={view} />
            </div>
        </div>
    );
}
