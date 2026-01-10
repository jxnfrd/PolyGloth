/**
 * Advanced GDELT Intelligence Module
 * 
 * Capability: Detects signals based on:
 * 1. TONE: Negative/Positive sentiment spikes.
 * 2. THEME: GDELT taxonomy (ECON_CRYPTOCURRENCY, GOV_REGULATION).
 * 3. DOMAIN: Official government sources (.gov.br, .gov.uk).
 */

const BASE_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

export interface GdeltAdvancedArticle {
    url: string;
    title: string;
    source: string;
    date: string;
    tone: number;
    theme?: string;
    domain: string;
}

// Helper to format query
async function queryGDELT(query: string, mode: 'artlist' | 'timelinevol', timespan: string = '1d'): Promise<GdeltAdvancedArticle[]> {
    const url = `${BASE_URL}?query=${encodeURIComponent(query)}&mode=${mode}&timespan=${timespan}&format=json&sort=DateDesc&maxrecords=10`;

    try {
        const response = await fetch(url);
        const text = await response.text();

        // Try parsing JSON
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('GDELT Raw Response Error:', text.substring(0, 200));
            return [];
        }

        if (!data.articles) return [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return data.articles.map((art: any) => ({
            url: art.url,
            title: art.title,
            source: art.source,
            date: art.seendate,
            tone: parseFloat(art.socialimage || '0'), // Map correctly if needed, usually 'tone' field is separate or part of extras
            domain: new URL(art.url).hostname
        }));
    } catch (error) {
        console.error('GDELT Advanced Query Error:', error);
        return [];
    }
}

/**
 * 1. Fetch Negative Signals (Crisis, Bans, Vetoes)
 * Query: (keywords) tone<-5 domain:gov.{countryCode}
 */
export async function fetchNegativeSignals(keywords: string[], countryCode: string): Promise<GdeltAdvancedArticle[]> {
    const keywordString = keywords.map(k => `"${k}"`).join(' OR ');

    const domainQuery = countryCode === 'us' ? `domain:gov` : `domain:gov.${countryCode}`;

    // Tone < -5 indicates strong negative sentiment
    const query = `(${keywordString}) tone<-5 ${domainQuery}`;
    return queryGDELT(query, 'artlist', '24h');
}

/**
 * 2. Fetch by Theme (Regulatory actions)
 */
export const GDELT_THEMES = {
    CRYPTO: 'ECON_CRYPTOCURRENCY',
    REGULATION: 'GOV_REGULATION',
    ELECTION: 'POL_ELECTION',
    DISASTER: 'DIS_ACCIDENT'
};

export async function fetchByTheme(theme: string, countryCode: string): Promise<GdeltAdvancedArticle[]> {
    const domainQuery = countryCode === 'us' ? `domain:gov` : `domain:gov.${countryCode}`;
    const query = `theme:${theme} ${domainQuery}`;
    return queryGDELT(query, 'artlist', '24h');
}

/**
 * 3. Fetch Gov Leaks / Official Docs
 * Restricts to high-authority domains
 */
export async function fetchGovDocs(countryCode: string): Promise<GdeltAdvancedArticle[]> {
    const domains: Record<string, string> = {
        'br': 'gov.br',
        'us': 'gov OR house.gov OR senate.gov',
        'uk': 'gov.uk',
        'eu': 'europa.eu OR europarl.europa.eu'
    };

    const domainPart = domains[countryCode] ? `domain:${domains[countryCode]}` : `domain:gov.${countryCode}`;
    const domainQuery = countryCode === 'us' ? `(domain:gov OR domain:house.gov OR domain:senate.gov)` : domainPart;

    const query = `${domainQuery} (regulation OR law OR bill OR decree)`;
    return queryGDELT(query, 'artlist', '48h');
}

/**
 * 4. Signal Spike Detector
 * Combines Tone + Gov Source for a specific market
 */
export async function detectSignalSpikes(marketTitle: string, marketKeywords: string[], countryCode = 'us'): Promise<{ negative: GdeltAdvancedArticle[], gov: GdeltAdvancedArticle[] }> {
    console.log(`[GDELT Advanced] Scanning for spikes: ${marketTitle}`);

    // Parallel detection
    const [negative, gov] = await Promise.all([
        fetchNegativeSignals(marketKeywords, countryCode),
        fetchGovDocs(countryCode) // Broad gov check, could refine with keywords
    ]);

    return { negative, gov };
}
