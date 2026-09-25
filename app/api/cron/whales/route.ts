import { WhaleTracker } from '@/lib/intelligence/whale-tracker';
import { NextResponse } from 'next/server';
import { authorizeCron } from '@/utils/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 59;

export async function GET(request: Request) {
    const denied = authorizeCron(request);
    if (denied) return denied;
    try {
        const url = new URL(request.url);
        const scan = Math.min(10, Number(url.searchParams.get('scan')) || 4);
        const pool = Math.min(50, Number(url.searchParams.get('pool')) || 20);
        const tracker = new WhaleTracker();
        const result = await tracker.updateTopTraders(scan, pool, { minPositionUsd: Number(url.searchParams.get('min')) || 1000 });
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error('❌ Whale cron failed:', error);
        return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
    }
}
