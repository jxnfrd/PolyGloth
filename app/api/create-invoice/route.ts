import { createInvoice } from '@/lib/payments/client';
import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
            error
        } = await supabase.auth.getUser();

        if (error || !user) {
            return NextResponse.json(
                { error: 'Unauthorized: User not logged in' },
                { status: 401 }
            );
        }

        // In a real app, you might want to validate planType from body
        // const { planType } = await req.json();
        const planType = 'monthly';

        const result = await createInvoice(user.id, planType);

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error in create-invoice route:', error);
        return NextResponse.json(
            { error: 'Internal Server Error' },
            { status: 500 }
        );
    }
}
