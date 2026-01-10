/**
 * World Bank Document Intelligence
 * 
 * Capability: Scans World Bank API for official documents relevant to crypto/economics.
 * API: https://search.worldbank.org/api/v2/wbdocuments
 */

const BASE_URL = 'https://search.worldbank.org/api/v2/wbdocuments';

export interface WorldBankDocument {
    id: string;
    title: string;
    date: string;
    abstract: string;
    pdf_url: string;
    country: string;
    type: string;
}

export async function scanWorldBankDocs(keywords: string[]): Promise<WorldBankDocument[]> {
    const query = keywords.map(k => `"${k}"`).join(' OR ');
    // qterm is for text search, fl fetches specific fields, format=json
    const url = `${BASE_URL}?format=json&qterm=${encodeURIComponent(query)}&rows=10&fl=docdt,display_title,abstracts,pdfurl,countryname,docty&sort=docdt desc`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        const docs = data.documents;

        if (!docs) return [];

        // API returns an object where keys are IDs, or sometimes an array. It's messy.
        // Usually data.documents is an object keyed by ID.
        return Object.values(docs).map((doc: any) => ({
            id: doc.id,
            title: doc.display_title,
            date: doc.docdt,
            abstract: doc.abstracts?.cdata || doc.abstracts || '',
            pdf_url: doc.pdfurl,
            country: doc.countryname,
            type: doc.docty
        }));

    } catch (error) {
        console.error('World Bank Query Error:', error);
        return [];
    }
}
