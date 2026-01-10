import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const signalId = searchParams.get('signal_id');
    const slug = searchParams.get('slug');

    if (!signalId || !slug) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const targetUrl = `https://polymarket.com/event/${slug}`;

    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        // Fire and forget logging (don't block redirect too long)
        // We use 'await' but it should be fast.
        await supabase.from('signal_interactions').insert({
            signal_id: signalId,
            user_id: user?.id || null, // Track user if logged in, otherwise null
            action: 'click_link',
            clicked_url: targetUrl
        });

    } catch (error) {
        console.error('Tracking error:', error);
        // Proceed to redirect anyway, don't break user flow
    }

    return NextResponse.redirect(targetUrl);
}
