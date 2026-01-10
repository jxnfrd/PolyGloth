import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import AdminWhalesTable from './AdminWhalesTable';

export const dynamic = 'force-dynamic';

export default async function WhalesAdminPage() {
    const supabase = await createClient();

    // Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return redirect('/signin');
    }

    // Fetch Whale Signals
    const { data: whales } = await supabase
        .from('whale_signals')
        .select(`
            *,
            tracked_traders (
                polymarket_user_id,
                leaderboard_rank
            )
        `)
        .order('discovered_at', { ascending: false })
        .limit(100);

    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
            <div className="md:flex md:items-center md:justify-between mb-8">
                <div className="min-w-0 flex-1">
                    <h2 className="text-2xl font-bold leading-7 text-white sm:truncate sm:text-3xl sm:tracking-tight">
                        🐋 Whale Signals
                    </h2>
                    <p className="mt-1 text-sm text-gray-400">
                        Tracking high-value bets from top Polymarket leaderboard traders.
                    </p>
                </div>
                <div className="mt-4 flex md:ml-4 md:mt-0">
                    <a href="/admin" className="inline-flex items-center rounded-md bg-white/10 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-white/20">
                        &larr; Back to Main Admin
                    </a>
                </div>
            </div>

            <AdminWhalesTable whales={whales || []} />
        </div>
    );
}
