import { fetchActiveMarkets } from './polymarket';
import { detectSignalSpikes, GdeltAdvancedArticle } from './gdelt-advanced';
import { analyzeContradiction } from './analyst';
import { calculateFreshnessScore } from './freshness';
import { createClient } from '@/utils/supabase/server';

export interface ScanResult {
    marketsScanned: number;
    signalsFound: number;
}

export async function runScan(): Promise<ScanResult> {
    console.log('Starting intelligence scan (V2: Multi-Source)...');
    let signalsFound = 0;
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Helper to log process
    const log = async (level: 'info' | 'warning' | 'error', msg: string, meta?: any) => {
        console.log(`[${level.toUpperCase()}] ${msg}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('processing_logs').insert({
            log_level: level,
            component: 'Orchestrator V2',
            message: msg,
            metadata: meta
        } as any);
    };

    await log('info', 'Starting new scan cycle');

    // 1. Fetch active markets
    // Increase limit for better testing of filtering
    const markets = await fetchActiveMarkets(30);
    await log('info', `Fetched ${markets.length} active markets`);

    for (const market of markets) {
        try {
            const stopWords = new Set(['will', 'the', 'be', 'on', 'in', 'of', 'to', 'a', 'an', 'is', 'for', 'by', 'this', 'week', 'year', 'month', 'day']);
            const cleanQuestion = market.question
                .replace(/[^\w\s]/g, '')
                .split(' ')
                .filter(w => !stopWords.has(w.toLowerCase()) && w.length > 2)
                .slice(0, 4);
            const keywords = cleanQuestion;

            // --- V2 INTELLIGENCE: MULTI-SOURCE DETECTION ---

            // 1. GDELT Advanced (Tone & Gov Docs)
            // Check US tone first (default)
            const spikes = await detectSignalSpikes(market.question, keywords, 'us'); // Default to US for now, could infer country from market

            let strongestEvidence: GdeltAdvancedArticle | null = null;
            let signalSource = 'NEWS_MEDIA';

            // Priority 1: Government Official Docs (Highest Authority)
            if (spikes.gov.length > 0) {
                strongestEvidence = spikes.gov[0];
                signalSource = 'OFFICIAL_GOV';
                await log('info', `Found GOV DOC for: ${market.question}`, { url: strongestEvidence.url });
            }
            // Priority 2: Negative Tone Spike (Crisis/Panic)
            else if (spikes.negative.length > 0) {
                strongestEvidence = spikes.negative[0];
                signalSource = 'NEWS_MEDIA'; // But distinct Tone Signal
                await log('info', `Found NEGATIVE SPIKE (Tone ${strongestEvidence.tone}) for: ${market.question}`);
            }
            // Priority 3: Standard News Fallback (Tier 3)
            else {
                // If strict filters failed, try standard news
                const { fetchStandardNews } = await import('./gdelt-advanced');
                const standardNews = await fetchStandardNews(keywords);

                if (standardNews.length > 0) {
                    strongestEvidence = standardNews[0];
                    signalSource = 'STANDARD_NEWS';
                    await log('info', `Found STANDARD NEWS for: ${market.question}`);
                }
            }

            if (!strongestEvidence) {
                // No advanced signal found
                // Enable this log to see "what was checked" even if no signal found
                await log('info', `Checked: ${market.question.substring(0, 50)}... (No signal found in Gov/Crisis/Standard)`);
                continue;
            }

            // 2. AI Analysis (Deep Check)
            // Verify if the signal actually relates to the market
            const article = strongestEvidence;
            const newsDate = new Date(article.date);
            const hoursOld = (new Date().getTime() - newsDate.getTime()) / (1000 * 60 * 60);

            if (hoursOld > 48) { // Allow slightly older for docs
                continue;
            }

            // Rate Limit Protection: Wait 4 seconds to stay under 15 RPM (Free Tier)
            await new Promise(resolve => setTimeout(resolve, 4000));

            const analysis = await analyzeContradiction(market, {
                title: article.title,
                source: article.source || article.domain,
                date: article.date
            });

            if (!analysis) {
                await log('warning', `AI Analysis failed for: ${market.question}`);
                continue;
            }

            // 3. Signal Generation
            // Accept if Score > 50 OR if we found a relevant Gov Doc/Standard News (even if score is low)
            if (analysis.contradictionScore > 50 || signalSource === 'OFFICIAL_GOV' || signalSource === 'STANDARD_NEWS') {
                // Calculate Freshness
                // Mock liquidity for now if API doesn't provide it, or use volume
                const liquidity = Number(market.volume) || 0;
                const freshness = calculateFreshnessScore(newsDate, liquidity, analysis.contradictionScore, analysis.confidence);

                const evidenceType = signalSource === 'OFFICIAL_GOV' ? 'OFFICIAL_DOCUMENT' : analysis.evidenceType;

                await log('info', `Signal Found! [${signalSource}] ${freshness.label}`, {
                    market: market.question,
                    score: analysis.contradictionScore,
                    freshness: freshness.score
                });

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await supabase.from('contrarian_signals').insert({
                    market_id: market.id,
                    market_slug: market.slug,
                    market_title: market.question,
                    market_liquidity: liquidity,

                    article_url: article.url,
                    article_language: 'en', // Advanced usually finds EN unless specified
                    source_outlet: article.domain, // Use domain for Authority
                    news_published_at: newsDate.toISOString(),

                    source_credibility: signalSource === 'OFFICIAL_GOV' ? 'high' : 'medium',

                    key_finding: analysis.keyFinding,
                    evidence_type: evidenceType,
                    contradiction_score: analysis.contradictionScore,
                    confidence: analysis.confidence,
                    tier: analysis.tier,
                    time_advantage_hours: analysis.timeAdvantageHours,

                    freshness_score: freshness.score,
                    indicator_color: freshness.color,
                    processing_log: [`Generated via Orchestrator V2 (Source: ${signalSource}) at ${new Date().toISOString()}`]
                } as any);

                signalsFound++;
            } else {
                await log('info', `Rejected: Low Score (${analysis.contradictionScore}) for ${market.question}`);
            }

        } catch (error) {
            await log('error', `Error processing market ${market.id}`, error);
        }
    }

    // Save Stats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('matching_stats').insert({
        total_markets: markets.length,
        markets_with_news: 0,
        signals_generated: signalsFound
    } as any);

    return { marketsScanned: markets.length, signalsFound };
}
