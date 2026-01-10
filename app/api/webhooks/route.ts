import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

// Init Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2024-12-18.acacia', // Using the version suggested in the prompt or latest
    typescript: true,
});

// Init Supabase Admin
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Prevent Vercel caching
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const body = await req.text();
    const signature = req.headers.get('Stripe-Signature') as string;
    let event: Stripe.Event;

    try {
        if (!process.env.STRIPE_WEBHOOK_SECRET) {
            // If no secret is set, we can't verify, but we shouldn't crash.
            // For now, return 400 or just log.
            console.error('Missing STRIPE_WEBHOOK_SECRET');
            return new NextResponse('Webhook Error: Missing Secret', { status: 400 });
        }

        event = stripe.webhooks.constructEvent(
            body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (error: any) {
        console.error(`Webhook Signature Verification Failed: ${error.message}`);
        return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 });
    }

    // Handle expected events
    // We will just log for now to satisfy the "missing route" error
    // logic can be expanded if the user actually switches back to Stripe.
    try {
        switch (event.type) {
            case 'checkout.session.completed':
                const checkoutSession = event.data.object as Stripe.Checkout.Session;
                console.log('Checkout session completed:', checkoutSession.id);
                // TODO: specific logic
                break;
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
                const subscription = event.data.object as Stripe.Subscription;
                console.log(`Subscription status: ${subscription.status}`);
                break;
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }
    } catch (error) {
        console.error('Error processing webhook:', error);
        return new NextResponse('Webhook Handler Failed', { status: 500 });
    }

    return NextResponse.json({ received: true });
}
