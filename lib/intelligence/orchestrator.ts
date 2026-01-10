import { fetchActiveMarkets } from './polymarket';
import { detectSignalSpikes, GdeltAdvancedArticle } from './gdelt-advanced';
import { analyzeContradiction } from './analyst';
import { calculateFreshnessScore } from './freshness';
import { createClient } from '@/utils/supabase/server';

export interface ScanResult {
    marketsScanned: number;
    signalsFound: number;
}

// Update signature to accept optional limit
export async function runScan(limit?: number): Promise<ScanResult> {
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
    const initialLimit = 30; // Define the initial limit for fetching
    let markets = await fetchActiveMarkets(initialLimit); // Use 'let' because 'markets' will be reassigned
    await log('info', `[MARKET_DISCOVERY] Fetched ${markets.length} active markets`);

    // Vercel Optimization:
    // If scanning a small batch, randomize the order so we don't always check the same top markets.
    if (initialLimit < 10) { // Use initialLimit here
        markets.sort(() => Math.random() - 0.5);
    }

    // Take the slice AFTER shuffling (or before if we wanted top-liquidity only, but coverage is better)
    markets = markets.slice(0, initialLimit); // Slice to the actual limit

    console.log(`[INFO] Processing batch of ${markets.length} markets...`);
    await log('info', `[MARKET_DISCOVERY] Starting scan cycle for ${markets.length} markets (Batch Mode)`);

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

            // --- PHASE 3: FETCH FINANCIAL DATA ---
            const { SourceRouter } = await import('./source-router');
            const router = new SourceRouter();
            await log('info', `[CONTEXT_COLLECTION] For market '${market.question.substring(0, 20)}...': Querying configured APIs...`);
            const financialContext = await router.routeAndFetch(market.question, keywords);

            await log('info', `[CONTEXT_COLLECTION] Result: ${financialContext.fundamentals?.length || 0} stocks, ${financialContext.economics?.length || 0} macro indicators`);

            const analysis = await analyzeContradiction(market, {
                title: article.title,
                source: article.source || article.domain,
                date: article.date
            }, financialContext);

            if (!analysis) {
                await log('warning', `AI Analysis failed for: ${market.question}`);
                continue;
            }

            // 3. Signal Generation
            // Decide Status based on thresholds
            let status = 'REJECTED';
            if (analysis.contradictionScore > 50 || signalSource === 'OFFICIAL_GOV' || signalSource === 'STANDARD_NEWS') {
                status = 'ACTIVE';
            }

            // Calculate Freshness
            const liquidity = Number(market.volume) || 0;
            const freshness = calculateFreshnessScore(newsDate, liquidity, analysis.contradictionScore, analysis.confidence);
            const evidenceType = signalSource === 'OFFICIAL_GOV' ? 'OFFICIAL_DOCUMENT' : analysis.evidenceType;

            const logMsg = status === 'ACTIVE'
                ? `[SIGNAL_GENERATION] Signal Found! [${signalSource}] ${freshness.label}`
                : `[SIGNAL_GENERATION] Signal Rejected (Low Score: ${analysis.contradictionScore})`;

            await log(status === 'ACTIVE' ? 'info' : 'warning', logMsg, {
                market: market.question,
                score: analysis.contradictionScore,
                status: status
            });

            const payload = {
                market_id: market.id,
                market_slug: market.slug || `market-${market.id}`,
                market_title: market.question,
                market_liquidity: isNaN(liquidity) ? 0 : liquidity,

                article_url: article.url || 'https://google.com',
                article_language: 'en',
                source_outlet: article.domain || 'Unknown',
                news_published_at: newsDate.toISOString(),

                source_credibility: (signalSource === 'OFFICIAL_GOV' ? 'high' : 'medium') as 'high' | 'medium' | 'low',

                key_finding: analysis.keyFinding || "No finding",
                evidence_type: evidenceType || "NEWS_MEDIA",
                contradiction_score: analysis.contradictionScore || 0,
                confidence: analysis.confidence || "Low",
                tier: analysis.tier || 3,
                time_advantage_hours: analysis.timeAdvantageHours || 0,

                freshness_score: freshness.score,
                indicator_color: freshness.color,
                processing_log: [`Generated via Orchestrator V2 (Source: ${signalSource}) at ${new Date().toISOString()}`],

                status: status // [NEW] Save status
            };

            // Insert into DB (Both ACTIVE and REJECTED)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: insertError } = await supabase.from('contrarian_signals').insert(payload as any);

            if (insertError) {
                await log('error', `DB Insert Failed for ${market.question}`, { error: insertError, payload });
                console.error('CRITICAL DB ERROR:', insertError, payload);
            } else {
                if (status === 'ACTIVE') signalsFound++;
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
