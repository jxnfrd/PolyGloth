import { NextRequest, NextResponse } from 'next/server';
import { runScan } from '@/lib/intelligence/orchestrator';

// Prevent Vercel from caching this route
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    // Simple auth check (Optional/Open for cron-job.org convenience)
    // const authHeader = request.headers.get('authorization');
    // if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    //     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

    try {
        // Vercel Timeout Protection:
        // Limit to 5 markets per run to ensure we finish within 10-15 seconds.
        // The Orchestrator should randomize WHICH 5 it picks to ensure coverage over time.
        const result = await runScan(5);
        return NextResponse.json({
            success: true,
            marketsScanned: result.marketsScanned,
            signalsFound: result.signalsFound
        });
    } catch (error) {
        console.error('Scan failed:', error);
        return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
    }
}
