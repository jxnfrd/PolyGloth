/**
 * Orchestrator V2 Types
 */

import { GdeltAdvancedArticle } from './gdelt-advanced';

export interface MultiSourceSignal {
    id: string;
    source: 'NEWS_MEDIA' | 'OFFICIAL_GOV' | 'LEGISLATIVE' | 'DOCUMENT';

    // Original data
    news?: GdeltAdvancedArticle;
    bill?: any; // LegiScan
    document?: any; // WorldBank

    // Analysis
    confidence: number; // 0-100
    contradictionScore: number; // 0-100 (for news/docs)

    // Metadata
    foundAt: Date;
    publishedAt: Date;
}
