/**
 * EUR-Lex Tracker (EU Legislative Intelligence)
 * 
 * Capability: Tracks EU Law proposals and adopted acts via RSS.
 * Source: https://eur-lex.europa.eu/rss/
 */

import { XMLParser } from 'fast-xml-parser';

// RSS Feed URLs
const EURLEX_FEEDS = {
    PROPOSAL: 'https://eur-lex.europa.eu/rss/EN_TS_32023R_.xml', // Proposals (This is a generic placeholder, usually structured by year/sector)
    ADOPTED: 'https://eur-lex.europa.eu/rss/EN_REG_32023R_.xml', // Adopted Regulations
    AI_ACT: 'https://eur-lex.europa.eu/rss/EN_QAA_32023R0286.xml' // Example specific document
};

// Generic "Recent Official Journal" feed is often more reliable for discovery
const OJ_FEED = 'https://eur-lex.europa.eu/rss/OJ/C_2024.xml?lang=en';

export interface EurLexDocument {
    title: string;
    link: string;
    pubDate: string;
    description: string;
    type: 'PROPOSAL' | 'ADOPTED' | 'OTHER';
}

export class EurLexTracker {
    private parser: XMLParser;

    constructor() {
        this.parser = new XMLParser();
    }

    async fetchRecentRegulations(): Promise<EurLexDocument[]> {
        // Fetch Official Journal RSS
        try {
            const response = await fetch(OJ_FEED);
            const xml = await response.text();

            const feed = this.parser.parse(xml);
            if (!feed.rss?.channel?.item) return [];

            const items = Array.isArray(feed.rss.channel.item)
                ? feed.rss.channel.item
                : [feed.rss.channel.item];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return items.map((item: any) => ({
                title: item.title,
                link: item.link,
                pubDate: item.pubDate,
                description: item.description,
                type: 'ADOPTED'
            })).filter((doc: EurLexDocument) =>
                // Filter for crypto/tech relevant docs if possible, or just return all for orchestrator filter
                doc.title.toLowerCase().includes('crypto') ||
                doc.title.toLowerCase().includes('asset') ||
                doc.title.toLowerCase().includes('market') ||
                doc.title.toLowerCase().includes('artificial intelligence')
            );

        } catch (error) {
            console.error('EUR-Lex Query Error:', error);
            return [];
        }
    }
}
