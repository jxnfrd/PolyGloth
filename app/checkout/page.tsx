import FastSpringEmbed from '@/components/checkout/FastSpringEmbed';

export const dynamic = 'force-dynamic';

export default function CheckoutPage() {
    return (
        <div className="min-h-screen bg-black text-white py-20">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold tracking-tight sm:text-5xl mb-4">
                        Secure Checkout 🔒
                    </h1>
                    <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
                        Complete your subscription via FastSpring. Access is granted instantly upon payment confirmation.
                    </p>
                </div>

                <FastSpringEmbed />

                <div className="mt-12 text-center text-sm text-zinc-600">
                    <p>Payments processed securely by FastSpring. We do not store your credit card details.</p>
                </div>
            </div>
        </div>
    );
}
