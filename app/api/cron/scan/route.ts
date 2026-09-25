import { runScan } from '@/lib/intelligence/orchestrator';
import { NextResponse } from 'next/server';
import { authorizeCron } from '@/utils/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // GDELT is 1 req / 5s; ~3 requests per market

export async function GET(request: Request) {
    const denied = authorizeCron(request);
    if (denied) return denied;
    try {
        const url = new URL(request.url);
        const limit = Math.min(30, Number(url.searchParams.get('limit')) || 10);
        const result = await runScan(limit);
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error('❌ Scan cron failed:', error);
        return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
    }
}
