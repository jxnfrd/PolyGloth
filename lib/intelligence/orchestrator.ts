import { fetchActiveMarkets } from './polymarket';
import { queryNonEnglishNews } from './gdelt';
import { analyzeContradiction } from './analyst';
import { createClient } from '@/utils/supabase/server';

export interface ScanResult {
    marketsScanned: number;
    signalsFound: number;
}

export async function runScan(): Promise<ScanResult> {
    console.log('Starting intelligence scan...');
    let signalsFound = 0;
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { calculateFreshnessScore } = await import('./freshness');

    // Helper to log process
    const log = async (level: 'info' | 'warning' | 'error', msg: string, meta?: any) => {
        console.log(`[${level.toUpperCase()}] ${msg}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('processing_logs').insert({
            log_level: level,
            component: 'Orchestrator',
            message: msg,
            metadata: meta
        } as any);
    };

    await log('info', 'Starting new scan cycle');

    // 1. Fetch active markets
    const markets = await fetchActiveMarkets(20); // Increased limit
    await log('info', `Fetched ${markets.length} active markets`, { market_ids: markets.map(m => m.id) });

    for (const market of markets) {
        try {
            // STEP 1: Market Validation
            // (Liquidity check > 5000 is mostly handled by API but good to verify if we had raw data)
            // We assume fetchActiveMarkets filters for active/volume already.

            // 2. Extract keywords
            const stopWords = new Set(['will', 'the', 'be', 'on', 'in', 'of', 'to', 'a', 'an', 'is', 'for', 'by', 'this', 'week', 'year', 'month', 'day']);
            const cleanQuestion = market.question
                .replace(/[^\w\s]/g, '')
                .split(' ')
                .filter(w => !stopWords.has(w.toLowerCase()) && w.length > 2)
                .slice(0, 4);
            const keywords = cleanQuestion;

            // STEP 2: News Fetching
            // Search in Portuguese and Spanish
            const articles = await queryNonEnglishNews(keywords, ['pt', 'es']);

            if (articles.length === 0) {
                // Log silently or debug
                // await log('info', `No news found for: ${market.question}`);
                continue;
            }

            // STEP 3: AI Analysis (Deep Check)
            const article = articles[0]; // Take best match

            // Check if news is recent enough for us (< 24h hard limit, score punishes >2h)
            const newsDate = new Date(article.date);
            const hoursOld = (new Date().getTime() - newsDate.getTime()) / (1000 * 60 * 60);

            if (hoursOld > 24) {
                await log('info', `News too old (${hoursOld.toFixed(1)}h) for: ${market.question}`);
                continue;
            }

            const analysis = await analyzeContradiction(market, {
                title: article.title,
                source: article.source,
                date: article.date
            });

            if (!analysis) {
                await log('warning', `AI Analysis failed for: ${market.question}`);
                continue;
            }

            // STEP 4: Signal Generation
            if (analysis.contradictionScore > 50) { // Lowered threshold to 50 to catch more, Tier logic handles quality

                // Calculate Freshness
                // Mock liquidity for now if API doesn't provide it, or use volume
                const liquidity = Number(market.volume) || 0;
                const freshness = calculateFreshnessScore(newsDate, liquidity, analysis.contradictionScore, analysis.confidence);

                await log('info', `Signal Found! ${freshness.label}`, {
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
                    article_language: article.language,
                    source_outlet: article.source,
                    news_published_at: newsDate.toISOString(),

                    key_finding: analysis.keyFinding,
                    evidence_type: analysis.evidenceType,
                    contradiction_score: analysis.contradictionScore,
                    confidence: analysis.confidence,
                    tier: analysis.tier,
                    time_advantage_hours: analysis.timeAdvantageHours,

                    freshness_score: freshness.score,
                    indicator_color: freshness.color,
                    processing_log: [`Generated at ${new Date().toISOString()}`]
                } as any);

                signalsFound++;
            } else {
                // Log why it failed (useful for "Authentication" of process)
                // await log('info', `Low text correlation (${analysis.contradictionScore}%)`, { market: market.question });
            }

        } catch (error) {
            await log('error', `Error processing market ${market.id}`, error);
        }
    }

    // Save Stats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('matching_stats').insert({
        total_markets: markets.length,
        markets_with_news: 0, // TODO: Track these counters properly in loop
        signals_generated: signalsFound
    } as any);

    return { marketsScanned: markets.length, signalsFound };
}
