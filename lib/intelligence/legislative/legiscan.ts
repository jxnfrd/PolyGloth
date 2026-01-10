/**
 * LegiScan Tracker (US Legislative Intelligence)
 * 
 * Capability: Tracks specific US Bills for status changes.
 * API: https://api.legiscan.com/
 */

const LEGISCAN_BASE_URL = 'https://api.legiscan.com';

export interface BillStatus {
    bill_number: string;
    status: number; // 1=Intro, 2=Engrossed, 3=Enrolled, 4=Passed, 5=Vetoed, 6=Failed
    status_date: string;
    last_action: string;
    text_url?: string;
    title: string;
}

// Key Crypto Bills to Track
export const CRYPTO_BILLS = {
    'FIT21': '1366113', // ID for HR4763 (Financial Innovation and Technology for the 21st Century Act)
    'CBDC_ANTI_SURVEILLANCE': '1342621', // HR5403
    'STABLECOIN': '1370214' // Placeholder ID, usually looked up by search
};

export class LegiScanTracker {
    private apiKey: string;

    constructor() {
        this.apiKey = process.env.LEGISCAN_API_KEY || '';
        if (!this.apiKey) {
            console.warn('LEGISCAN_API_KEY is missing. Legislative tracking disabled.');
        }
    }

    /**
     * Get latest status of a specific bill by ID
     */
    async trackBill(billId: string): Promise<BillStatus | null> {
        if (!this.apiKey) return null;

        const url = `${LEGISCAN_BASE_URL}/?key=${this.apiKey}&op=getBill&id=${billId}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'ERROR' || !data.bill) {
                console.error(`LegiScan Error for Bill ${billId}:`, data.alert?.message);
                return null;
            }

            const b = data.bill;
            return {
                bill_number: b.bill_number,
                status: b.status,
                status_date: b.status_date,
                last_action: b.history?.[b.history.length - 1]?.action || 'No history',
                text_url: b.texts?.[b.texts.length - 1]?.url,
                title: b.title
            };

        } catch (error) {
            console.error('LegiScan Network Error:', error);
            return null;
        }
    }

    /**
     * Search for bills by keyword (e.g., "cryptocurrency")
     */
    async searchBills(query: string, state = 'US'): Promise<any[]> {
        if (!this.apiKey) return [];
        const url = `${LEGISCAN_BASE_URL}/?key=${this.apiKey}&op=search&state=${state}&query=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url);
            const data = await response.json();
            return data.searchresult ? Object.values(data.searchresult).filter(item => typeof item === 'object') : [];
        } catch (e) {
            return [];
        }
    }
}
