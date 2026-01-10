import { createClient } from '@/utils/supabase/server';
import DashboardClientView from './DashboardClientView';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
    const supabase = await createClient();

    // Fetch News-Based Signals
    const { data: signals } = await supabase
        .from('contrarian_signals')
        .select('*')
        .eq('status', 'ACTIVE') // Filter by ACTIVE only
        .order('created_at', { ascending: false });

    // Fetch Pure AI Predictions
    const { data: predictions } = await supabase
        .from('pure_ai_predictions')
        .select('*')
        .order('analysis_timestamp', { ascending: false });

    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-white">PolyGlot Intelligence Dashboard</h1>
            <p className="mt-2 text-sm text-gray-400">Real-time market intelligence: News Arbitrage & Pure AI Reasoning.</p>

            <div className="mt-8">
                <DashboardClientView
                    signals={signals || []}
                    predictions={predictions || []}
                />
            </div>
        </div>
    );
}
