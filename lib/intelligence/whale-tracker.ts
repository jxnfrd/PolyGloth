import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Initialize Supabase
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface TraderData {
    username: string; // Polymarket ID/Handle
    rank: number;
    volume: number;
}

interface OpenPosition {
    marketSlug: string;
    marketQuestion: string;
    direction: 'YES' | 'NO';
    size: number;
    price: number;
}

export class WhaleTracker {
    private BASE_URL = 'https://polymarket.com';

    // Helper: Sleep to respect rate limits
    private delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Helper: Fetch with User-Agent
    private async fetchWithDelay(url: string) {
        console.log(`   🕸️ Fetching: ${url}`);
        await this.delay(5000); // 5s delay
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'PolyGlot-Intelligence/1.0 (Whale Research Bot; +https://polygloth.com)',
                'Accept': 'text/html,application/xhtml+xml,application/xml'
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }
        return await response.text();
    }

    // 1. Orchestrator
    async updateTopTraders(limit = 10) {
        console.log(`🐳 Starting Whale Scan (Top ${limit})...`);

        try {
            // A. Fetch Leaderboard
            const leaderboardHtml = await this.fetchWithDelay(`${this.BASE_URL}/leaderboard`);
            const traders = this.parseLeaderboard(leaderboardHtml, limit);
            console.log(`✅ Found ${traders.length} traders on leaderboard.`);

            for (const trader of traders) {
                // B. Upsert Trader to DB
                const dbTraderId = await this.upsertTrader(trader);
                if (!dbTraderId) continue;

                // C. Fetch Activity/Profile
                // Note: Polymarket URL structure for profiles is /profile/[id] or /profile/[username]
                // We assume trader.username is valid for the URL.
                try {
                    const activityHtml = await this.fetchWithDelay(`${this.BASE_URL}/profile/${trader.username}`);

                    // D. Parse Positions
                    const positions = this.parseOpenPositions(activityHtml);
                    console.log(`   Found ${positions.length} positions for ${trader.username}`);

                    // E. Generate Signals
                    await this.generateSignals(positions, dbTraderId, trader.rank);

                } catch (err) {
                    console.error(`   ❌ Failed to process trader ${trader.username}:`, err);
                }

                // Wait before next trader
                await this.delay(3000);
            }

            console.log('✅ Whale Scan Complete.');
        } catch (error) {
            console.error('❌ Whale Scan Failed:', error);
        }
    }

    // 2. Parsers
    private parseLeaderboard(html: string, limit: number): TraderData[] {
        const $ = cheerio.load(html);
        const traders: TraderData[] = [];

        // Note: Selectors rely on Polymarket's current DOM. 
        // This is a best-effort guess based on common table structures. 
        // Real implementation requires inspecting the live site source.
        // Assuming a standard table structure or list for now.

        // Strategy: Look for the ranked list items.
        // If specific classes are obfuscated, we might need more robust traversing.
        // For MVP, we will try to find links to /profile/...

        $('a[href^="/profile/"]').each((i, el) => {
            if (i >= limit) return;
            const href = $(el).attr('href');
            const username = href?.split('/profile/')[1];

            // Try to find volume text in the same row/container
            const row = $(el).closest('div, tr, li');
            const volumeText = row.text(); // Rough extraction

            // Simple heuristic to extract a volume number (e.g., "$10m", "$500k")
            // This is fragile and should be refined with actual DOM inspection
            const volume = 1000000; // Placeholder defaults if parsing fails

            if (username) {
                traders.push({
                    username: username,
                    rank: i + 1,
                    volume: volume // TODO: Parse actual volume
                });
            }
        });

        // Deduplicate
        const uniqueTraders = Array.from(new Map(traders.map(t => [t.username, t])).values());
        return uniqueTraders.slice(0, limit);
    }

    private parseOpenPositions(html: string): OpenPosition[] {
        const $ = cheerio.load(html);
        const positions: OpenPosition[] = [];

        // Again, heuristic parsing. 
        // We look for "Positions" section and links to markets.
        $('a[href^="/event/"]').each((i, el) => {
            const href = $(el).attr('href');
            const slug = href?.split('/event/')[1];
            const text = $(el).text().trim();

            // Try to deduce direction and size
            // Often "Yes" or "No" is near the market title
            // This is highly DOM-structure dependent.

            if (slug && text) {
                positions.push({
                    marketSlug: slug,
                    marketQuestion: text,
                    direction: 'YES', // Defaulting/Guessing for now
                    size: 500, // Placeholder
                    price: 0.50 // Placeholder
                });
            }
        });

        return positions;
    }

    // 3. Database Ops
    private async upsertTrader(trader: TraderData): Promise<string | null> {
        const { data, error } = await supabase
            .from('tracked_traders')
            .upsert({
                polymarket_user_id: trader.username,
                leaderboard_rank: trader.rank,
                total_volume: trader.volume,
                last_updated: new Date().toISOString()
            }, { onConflict: 'polymarket_user_id' })
            .select('id')
            .single();

        if (error) {
            console.error('   DB Upsert Error:', error.message);
            return null;
        }
        return data.id;
    }

    private async generateSignals(positions: OpenPosition[], traderId: string, rank: number) {
        for (const pos of positions) {
            // Signal Strength Logic
            let strength = 'low';
            if (rank <= 5 && pos.size > 1000) strength = 'high';
            else if (rank <= 20 || pos.size > 500) strength = 'medium';

            // Ensure we save even small positions for visibility (MVP)
            const { error } = await supabase
                .from('whale_signals')
                .upsert({
                    trader_id: traderId,
                    market_id: pos.marketSlug,
                    market_slug: pos.marketSlug,
                    market_question: pos.marketQuestion,
                    trader_action: pos.direction,
                    position_size_usd: pos.size,
                    average_buy_price: pos.price,
                    potential_payout: (pos.size / pos.price),
                    signal_strength: strength
                }, { onConflict: 'market_id,trader_id' });

            if (error) {
                // Ignore duplicate key errors if they come up, or log warn
                // console.warn('Signal save error:', error.message);
            }
        }
    }
}
