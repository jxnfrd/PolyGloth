import axios from 'axios';

const BITCART_API_URL = process.env.BITCART_API_URL;
const BITCART_STORE_ID = process.env.BITCART_STORE_ID;
// Bitcart often doesn't strictly need an API key for public invoice creation if store is public, 
// but usually it's good practice or required depending on settings. 
// We'll trust the plan and use no specific Auth header if typical public endpoint, 
// OR assume Basic Auth/Token if defined. Docs say /api/invoices usually requires auth or open store.
// We'll add a check for API Key just in case.

export async function createInvoice(userId: string, planType: string = 'monthly') {
    if (!BITCART_API_URL || !BITCART_STORE_ID) {
        throw new Error('Bitcart.ai configuration is missing.');
    }

    try {
        const response = await axios.post(
            `${BITCART_API_URL}/api/invoices`,
            {
                store_id: BITCART_STORE_ID,
                price: "29",
                store_currency: "USD", // Bitcart uses 'store_currency' or just defaults to store settings. 'price' and 'currency' often work.
                // Bitcart docs: price, order_id, ...
                // Let's use 'price' and 'currency' if supported, or rely on store default.
                // Actually, payload for Bitcart 3.0+ (BitcartCC):
                // { "price": 29, "store_id": ..., "currency": "USD", "metadata": ... }
                currency: "USD",
                order_id: userId, // We can use order_id to track user
                notification_url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/bitcart`,
                redirect_url: `${process.env.NEXT_PUBLIC_SITE_URL}/account`,
                metadata: {
                    userId: userId,
                    planType: planType
                }
            },
            // If auth is needed:
            // { headers: { Authorization: `Bearer ${process.env.BITCART_API_KEY}` } }
        );

        // Bitcart returns created invoice object
        // Link is usually invoice_url or similar. 
        // If using Bitcart.ai (the hosted or self-hosted instance), the checkout link is often returned.
        // response.data.url or response.data.id to construct url. 
        // self-hosted: {API_HOST}/i/{invoice_id}

        const invoiceId = response.data.id;
        const checkoutLink = `${BITCART_API_URL}/i/${invoiceId}`;

        return {
            checkoutLink: checkoutLink,
            invoiceId: invoiceId
        };
    } catch (error) {
        console.error('Error creating Bitcart invoice:', error);
        throw error;
    }
}
