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

    // 1. Fetch active markets
    const markets = await fetchActiveMarkets(10); // Limit to 10 for now
    console.log(`Fetched ${markets.length} active markets.`);

    // Initialize Supabase Client
    // Note: We need a way to use Supabase in a non-request context if this runs via script, 
    // but headers/cookies might be missing. 
    // For Cron API route it's fine. For script, we might need createClient from admin or handle env vars directly.
    // The previously used `createClient` in `server.ts` uses `createServerComponentClient` which needs headers.
    // We should use `createClient` from `@supabase/supabase-js` directly for background tasks if `server.ts` fails,
    // but let's try to use the admin client logic if available or just raw supabase-js.
    // Actually, `utils/supabase/admin.ts` likely has the admin client.

    // Using locally imported admin client if possible or just standard client
    // Let's assume we can use the admin client for writing signals.
    /* 
       import { toSupabase } from ... 
       Actually, let's look at `utils/supabase/admin.ts` or similar.
       If not available, I will init a direct client here for safety in background jobs.
    */

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // Dynamic import to avoid issues if we are in a specific environment, 
    // but standard import is fine for server-side.
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    for (const market of markets) {
        try {
            // 2. Extract keywords
            // Improve: Remove common words and keep significant terms.
            // A simple approach: Remove "Will", "the", "be", "on", "in", "of", "to", "?", etc.
            const stopWords = new Set(['will', 'the', 'be', 'on', 'in', 'of', 'to', 'a', 'an', 'is', 'for', 'by', 'this', 'week', 'year', 'month', 'day']);
            const cleanQuestion = market.question
                .replace(/[^\w\s]/g, '') // Remove punctuation
                .split(' ')
                .filter(w => !stopWords.has(w.toLowerCase()) && w.length > 2)
                .slice(0, 4); // Take top 4 significant words

            // Also add exact phrase if it's short enough, but for GDELT keywords are better separately OR'd or AND'd?
            // GDELT `keyword1 keyword2` implies AND.
            // We want broad search first.
            const keywords = cleanQuestion;

            console.log(`Searching GDELT for: ${keywords.join(' ')}`);

            // 3. Query GDELT
            // We'll search in Portuguese and Spanish for now
            const articles = await queryNonEnglishNews(keywords, ['pt', 'es']);

            if (articles.length === 0) continue;

            // 4. Analyze the first/best article
            const article = articles[0]; // Take the most recent/relevant

            const analysis = await analyzeContradiction(market, {
                title: article.title,
                source: article.source,
                date: article.date
            });

            if (analysis && analysis.contradictionScore > 70) {
                // 5. Store Signal
                console.log(`High confidence signal found for: ${market.question}`);

                await supabase.from('contrarian_signals').insert({
                    market_id: market.id,
                    market_slug: market.slug,
                    market_title: market.question,
                    article_url: article.url,
                    article_language: article.language,
                    key_finding: analysis.keyFinding,
                    evidence_type: analysis.evidenceType,
                    contradiction_score: analysis.contradictionScore,
                    confidence: analysis.confidence,
                    tier: analysis.tier,
                    time_advantage_hours: analysis.timeAdvantageHours
                });

                signalsFound++;
            }

        } catch (error) {
            console.error(`Error processing market ${market.id}:`, error);
        }
    }

    return { marketsScanned: markets.length, signalsFound };
}
