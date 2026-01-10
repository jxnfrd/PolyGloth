import { WhaleTracker } from '@/lib/intelligence/whale-tracker';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 59; // Allow longer timeouts for scraping

export async function GET(request: Request) {
    try {
        console.log('🐳 Cron: Starting Whale Scan...');
        const tracker = new WhaleTracker();

        // TIMEOUT FIX:
        // Scan only 2 traders randomly selected from the Top 20.
        // This keeps execution under 10 seconds (Serverless Limit).
        // Cron should run more frequently (e.g., every 15-30 mins) to compensate.
        await tracker.updateTopTraders(2, 20);

        return NextResponse.json({ success: true, message: 'Whale scan complete' });
    } catch (error: any) {
        console.error('❌ Cron Failed:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
