import { NextRequest, NextResponse } from 'next/server';
import { runScan } from '@/lib/intelligence/orchestrator';

// Prevent Vercel from caching this route
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    // Simple auth check
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await runScan();
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
