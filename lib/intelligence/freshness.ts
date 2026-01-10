/**
 * Calculates the Freshness Score (0-100) and Indicator Color for a signal.
 * 
 * Algorithm:
 * - News Age (40pts): <2h is max.
 * - Liquidity (20pts): Bonus for high volume.
 * - Contradiction (30pts): High score = high impact.
 * - Confidence (10pts): AI certainty.
 */

export interface FreshnessResult {
    score: number;
    color: 'green' | 'orange' | 'red';
    label: string;
}

export function calculateFreshnessScore(
    newsPublishedAt: Date,
    marketLiquidity: number,
    contradictionScore: number,
    aiConfidence: string
): FreshnessResult {

    const now = new Date();
    // Calculate difference in hours
    const diffMs = now.getTime() - newsPublishedAt.getTime();
    const newsAgeHours = diffMs / (1000 * 60 * 60);

    // 1. Base Score: News Age (Max 40)
    // 0h = 40pts, 4h = 0pts.
    let score = Math.max(0, 40 - (newsAgeHours * 10));

    // 2. Liquidity Bonus (Max 20)
    if (marketLiquidity > 50000) score += 20;
    else if (marketLiquidity > 10000) score += 15;
    else if (marketLiquidity > 5000) score += 10;

    // 3. Contradiction Impact (Max 30)
    // Score of 100 gives 30pts. Score of 50 gives 15pts.
    score += (contradictionScore * 0.3);

    // 4. AI Confidence Bonus (Max 10)
    if (aiConfidence.toLowerCase() === 'high') score += 10;
    else if (aiConfidence.toLowerCase() === 'medium') score += 5;

    // Cap at 100
    score = Math.min(100, Math.round(score));

    // Determine Indicator
    let color: 'green' | 'orange' | 'red' = 'red';
    let label = 'Stale / Risky';

    if (score >= 80) {
        color = 'green';
        label = 'Fresh - Bet Now';
    } else if (score >= 60) {
        color = 'orange';
        label = 'Caution';
    }

    return { score, color, label };
}
