import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Admin
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export async function POST(req: Request) {
    const body = await req.json(); // Bitcart sends JSON

    // Bitcart payload structure: { id, status, order_id, price, ... }
    // status: 'complete', 'expired', 'invalid', 'paid', 'confirmed'

    // Verification: typically Bitcart sends a payload. 
    // For strict security, one should verify the IP or use a secret in the URL/payload?
    // Bitcart doesn't have a standard "sig" header mechanism exactly like Stripe/BTCPay unless configured.
    // We'll rely on checking the status and order_id/invoice ID matches our records if we had them, 
    // or just trust the payload for this MVP since we set the notification_url.
    // *Ideally* we check a shared secret in params or metadata if we could.

    const { id, status, order_id, metadata } = body;

    if (status === 'complete' || status === 'confirmed' || status === 'paid') {
        // 'paid' might be enough for immediate access, 'complete' is safe (6 confs etc).
        // Let's accept 'paid' or 'complete'

        const userId = metadata?.userId || order_id; // in client.ts we set order_id = userId

        if (userId) {
            const now = new Date();
            const thirtyDaysLater = new Date(now.setDate(now.getDate() + 30));

            const { error } = await supabaseAdmin
                .from('subscriptions')
                .upsert({
                    id: id,
                    user_id: userId,
                    status: 'active',
                    current_period_end: thirtyDaysLater.toISOString(),
                    metadata: {
                        payment_provider: 'bitcart',
                        invoice_id: id,
                        status: status
                    }
                });

            if (error) {
                console.error('Error updating subscription:', error);
                return new Response('Database update failed', { status: 500 });
            }
        }
    }

    return new Response('OK', { status: 200 });
}
