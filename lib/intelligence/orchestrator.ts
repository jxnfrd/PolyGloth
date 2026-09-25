import { createClient } from '@supabase/supabase-js';
import { fetchActiveMarkets, PolymarketMarket } from './polymarket';
import { detectSignalSpikes, fetchStandardNews, GdeltAdvancedArticle, GdeltRateLimitError } from './gdelt-advanced';
import { analyzeContradiction } from './analyst';
import { calculateFreshnessScore } from './freshness';
import { SourceRouter } from './source-router';

export interface ScanResult {
    marketsScanned: number;
    signalsFound: number;
    rejected: number;
    errors: number;
}

const STOP = new Set(['will', 'the', 'be', 'on', 'in', 'of', 'to', 'a', 'an', 'is', 'for', 'by', 'this', 'week', 'year', 'month', 'day', 'before', 'after', 'than', 'more', 'less', 'and', 'or', 'at', 'from', 'with', 'win', 'reach', 'hit', 'over', 'under', 'any', 'does', 'do', 'have', 'has', 'end', 'top']);

/**
 * Keywords for a GDELT query: proper nouns and numbers first, then other content words.
 * Max 3 terms, AND-ed by the GDELT client. Fewer, more specific terms beat OR-lists of
 * generic words (the old OR-list matched "Boston College Eagles" to .gov documents).
 */
export function extractKeywords(question: string): string[] {
    const tokens = question.replace(/[^\w\s$%.-]/g, ' ').split(/\s+/).filter(Boolean);
    const MONTHS = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i;
    const proper = tokens.filter(t => /^[A-Z][a-zA-Z.]{2,}$/.test(t) && !STOP.has(t.toLowerCase()) && !MONTHS.test(t));
    const numbers = tokens.filter(t => /^\$?\d[\d,.]*[kKmMbB%]?$/.test(t) && !/^(19|20)\d\d$/.test(t));
    const rest = tokens.filter(t => !proper.includes(t) && !numbers.includes(t) && t.length > 3 && !STOP.has(t.toLowerCase()) && !MONTHS.test(t) && !/^\d+$/.test(t));
    const uniq = (arr: string[]) => Array.from(new Set(arr));
    // proper nouns first, then content words, numbers last (a bare "25" or "2027" matches everything)
    return uniq([...proper, ...rest, ...numbers]).slice(0, 3);
}

export async function runScan(limit = 30, opts: { minVolume?: number } = {}): Promise<ScanResult> {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const result: ScanResult = { marketsScanned: 0, signalsFound: 0, rejected: 0, errors: 0 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const log = async (level: 'info' | 'warning' | 'error', message: string, metadata?: any) => {
        console.log(`[${level.toUpperCase()}] ${message}`);
        await supabase.from('processing_logs').insert({ log_level: level, component: 'Orchestrator V3', message, metadata });
    };

    await log('info', 'Starting scan cycle');

    // 1. Markets: real volume ordering, no sports, no near-certain prices.
    const markets = await fetchActiveMarkets(limit, { minVolume: opts.minVolume ?? 50_000, excludeSports: true });
    result.marketsScanned = markets.length;
    await log('info', `[MARKET_DISCOVERY] ${markets.length} candidate markets`);

    const router = new SourceRouter();

    for (const market of markets) {
        try {
            const keywords = extractKeywords(market.question);
            if (keywords.length < 2) { await log('info', `Skip (no usable keywords): ${market.question}`); continue; }

            // 2. Evidence (GDELT, serialized inside the client)
            let evidence: GdeltAdvancedArticle | null = null;
            let signalSource: 'OFFICIAL_GOV' | 'NEGATIVE_TONE' | 'STANDARD_NEWS' = 'STANDARD_NEWS';
            try {
                const spikes = await detectSignalSpikes(market.question, keywords, 'us');
                if (spikes.gov.length) { evidence = spikes.gov[0]; signalSource = 'OFFICIAL_GOV'; }
                else if (spikes.negative.length) { evidence = spikes.negative[0]; signalSource = 'NEGATIVE_TONE'; }
                else { const std = await fetchStandardNews(keywords); if (std.length) { evidence = std[0]; signalSource = 'STANDARD_NEWS'; } }
            } catch (e) {
                if (e instanceof GdeltRateLimitError) { await log('error', 'GDELT rate limit hit, aborting cycle'); result.errors++; break; }
                throw e;
            }

            if (!evidence) { await log('info', `No evidence: ${market.question.slice(0, 60)} [${keywords.join(', ')}]`); continue; }

            const newsDate = new Date(evidence.date);
            const hoursOld = (Date.now() - newsDate.getTime()) / 3_600_000;
            if (!Number.isFinite(hoursOld) || hoursOld > 48) continue;

            // 3. Context + AI
            const financialContext = await router.routeAndFetch(market.question, keywords);
            const analysis = await analyzeContradiction(market, { title: evidence.title, source: evidence.domain, date: evidence.date, url: evidence.url }, financialContext);
            if (!analysis) { await log('warning', `AI analysis failed: ${market.question.slice(0, 60)}`); result.errors++; continue; }

            // 4. Decision. ACTIVE only when the evidence is relevant, takes a side, and the edge is real.
            const edgePct = Math.abs(analysis.aiProbability - market.yesPrice * 100);
            const status = analysis.relevant && analysis.direction !== 'NONE' && analysis.contradictionScore >= 60 && edgePct >= 10 ? 'ACTIVE' : 'REJECTED';

            const freshness = calculateFreshnessScore(newsDate, market.liquidity, analysis.contradictionScore, analysis.confidence);
            const payload = {
                market_id: market.id,
                market_slug: market.slug,
                market_title: market.question,
                market_liquidity: market.liquidity,
                market_yes_price: market.yesPrice,
                condition_id: market.conditionId,
                market_end_date: market.endDate || null,
                article_url: evidence.url,
                article_language: evidence.language || 'en',
                source_outlet: evidence.domain,
                news_published_at: newsDate.toISOString(),
                source_credibility: signalSource === 'OFFICIAL_GOV' ? 'high' : 'medium',
                key_finding: analysis.keyFinding || 'No finding',
                evidence_type: signalSource === 'OFFICIAL_GOV' ? 'OFFICIAL_DOCUMENT' : analysis.evidenceType.toUpperCase(),
                contradiction_score: analysis.contradictionScore,
                confidence: analysis.confidence,
                tier: analysis.tier,
                time_advantage_hours: analysis.timeAdvantageHours,
                ai_probability: analysis.aiProbability,
                direction: analysis.direction,
                ai_model: analysis.model,
                freshness_score: freshness.score,
                indicator_color: freshness.color,
                processing_log: [`Orchestrator V3 ${new Date().toISOString()} source=${signalSource} keywords=${keywords.join('|')} relevant=${analysis.relevant} edge=${edgePct.toFixed(1)}pp`],
                status
            };

            const { error } = await supabase.from('contrarian_signals').insert(payload);
            if (error) { await log('error', `DB insert failed: ${market.question.slice(0, 60)}`, { error: error.message }); result.errors++; continue; }
            if (status === 'ACTIVE') result.signalsFound++; else result.rejected++;
            await log(status === 'ACTIVE' ? 'info' : 'warning', `[${status}] ${market.question.slice(0, 60)} | market ${Math.round(market.yesPrice * 100)}% vs AI ${analysis.aiProbability}% ${analysis.direction} | score ${analysis.contradictionScore}`);
        } catch (error) {
            result.errors++;
            await log('error', `Error processing market ${market.id}: ${(error as Error).message}`);
        }
    }

    await supabase.from('matching_stats').insert({ total_markets: result.marketsScanned, markets_with_news: result.signalsFound + result.rejected, signals_generated: result.signalsFound });
    await log('info', `Scan done: ${JSON.stringify(result)}`);
    return result;
}

export type { PolymarketMarket };
