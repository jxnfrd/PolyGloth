import { WhaleTracker } from '@/lib/intelligence/whale-tracker';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        console.log('🐳 Cron: Starting Whale Scan...');
        const tracker = new WhaleTracker();

        // Scan top 15 traders
        await tracker.updateTopTraders(15);

        return NextResponse.json({ success: true, message: 'Whale scan complete' });
    } catch (error: any) {
        console.error('❌ Cron Failed:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
