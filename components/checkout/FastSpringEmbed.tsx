'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

export default function FastSpringEmbed() {
    const [loaded, setLoaded] = useState(false);
    const STOREFRONT = 'apexvanguarddynamics.test.onfastspring.com/embedded-poligloth';

    return (
        <div className="w-full min-h-[600px] bg-black/50 rounded-xl border border-zinc-800 p-4">
            {/* Loading Indicator */}
            {!loaded && (
                <div className="flex flex-col items-center justify-center py-20 animate-pulse">
                    <div className="h-10 w-10 border-t-2 border-b-2 border-indigo-500 rounded-full animate-spin mb-4"></div>
                    <p className="text-zinc-400">Loading Secure Storefront...</p>
                </div>
            )}

            {/* FastSpring Container */}
            <div id="fsc-embedded-checkout-container" style={{ minHeight: '500px', width: '100%' }}></div>

            {/* FastSpring Script */}
            <Script
                id="fsc-api"
                src="https://sbl.onfastspring.com/sbl/1.0.6/fastspring-builder.min.js"
                strategy="afterInteractive"
                data-storefront={STOREFRONT}
                onLoad={() => {
                    console.log('💳 FastSpring SDK Loaded');
                    setLoaded(true);
                }}
                onError={(e) => {
                    console.error('❌ FastSpring Load Error:', e);
                }}
            />
        </div>
    );
}
