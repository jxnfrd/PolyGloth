import { PolymarketMarket } from './polymarket';
import { StandardizedContext } from './types/sources';
import { askJson } from './llm';

/**
 * Contradiction analyst.
 *
 * Audit 2026-09-25: the old prompt never told the model what the market currently
 * prices, so "contradiction" was unmeasurable. The model now sees the live YES price
 * and must return its own probability + direction; the orchestrator computes the edge.
 */
export interface AnalysisResult {
    keyFinding: string;
    evidenceType: 'official_document' | 'direct_quote' | 'expert_analysis' | 'rumor';
    /** 0-100: how strongly the evidence moves the probability away from the market price. */
    contradictionScore: number;
    confidence: 'High' | 'Medium' | 'Low';
    tier: 1 | 2 | 3;
    timeAdvantageHours: number;
    /** Model's own probability (%) that outcomes[0] (YES) resolves true. */
    aiProbability: number;
    /** Which side the evidence favours. */
    direction: 'YES' | 'NO' | 'NONE';
    /** Does the evidence actually concern this market? Guards against keyword false positives. */
    relevant: boolean;
    reasoning: string;
    model: string;
}

export async function analyzeContradiction(
    market: PolymarketMarket,
    evidence: { title: string; source: string; date: string; url?: string; snippet?: string },
    financialContext?: StandardizedContext
): Promise<AnalysisResult | null> {
    let contextString = '';
    if (financialContext) {
        if (financialContext.fundamentals?.length) contextString += '\nFUNDAMENTALS:\n' + financialContext.fundamentals.map(f => `- ${f.symbol}: price $${f.latestPrice}, P/E ${f.keyStats.peRatio}`).join('\n');
        if (financialContext.economics?.length) contextString += '\nMACRO DATA:\n' + financialContext.economics.map(e => `- ${e.title}: ${e.latestValue} (${e.date})`).join('\n');
        if (financialContext.forex?.length) contextString += '\nFOREX:\n' + financialContext.forex.map(f => `- ${f.from}/${f.to}: ${f.rate} (${f.date})`).join('\n');
        if (financialContext.newsSentiment?.length) contextString += '\nSENTIMENT:\n' + financialContext.newsSentiment.join('\n');
    }

    const yesPct = Math.round(market.yesPrice * 100);
    const prompt = `
You are a prediction-market analyst. Decide whether a piece of evidence changes the probability of a Polymarket market.

MARKET QUESTION: "${market.question}"
MARKET DESCRIPTION / RESOLUTION RULES: "${market.description.slice(0, 1200)}"
OUTCOMES: ${JSON.stringify(market.outcomes)}
CURRENT MARKET PRICE: ${yesPct}% for "${market.outcomes[0] || 'Yes'}"
MARKET CLOSES: ${market.endDate}
TODAY: ${new Date().toISOString().slice(0, 10)}

EVIDENCE:
- Title: "${evidence.title}"
- Source: ${evidence.source}
- Published: ${evidence.date}
${evidence.snippet ? `- Excerpt: ${evidence.snippet}` : ''}
${contextString ? `\nADDITIONAL DATA:${contextString}` : ''}

Rules:
1. First decide if the evidence is genuinely about THIS market (same entity, same event, same timeframe). Keyword overlap alone is NOT relevance. If not relevant, set relevant=false, direction="NONE", contradictionScore=0.
2. If relevant, estimate your own probability (aiProbability, 1-99) that "${market.outcomes[0] || 'Yes'}" resolves true, given the evidence and the resolution rules.
3. contradictionScore = how far and how confidently your estimate diverges from the market's ${yesPct}%: 0 = agrees, 100 = strong, well-sourced disagreement.
4. tier: 1 if contradictionScore >= 80, 2 if 60-79, else 3.
5. Be conservative. Prefer "NONE" over a weak call.

Return ONLY this JSON object:
{
  "relevant": true | false,
  "keyFinding": "one sentence",
  "evidenceType": "official_document" | "direct_quote" | "expert_analysis" | "rumor",
  "aiProbability": number,
  "direction": "YES" | "NO" | "NONE",
  "contradictionScore": number,
  "confidence": "High" | "Medium" | "Low",
  "tier": 1 | 2 | 3,
  "timeAdvantageHours": number,
  "reasoning": "brief"
}`;

    try {
        const { data, model } = await askJson<Partial<AnalysisResult>>(prompt);
        const score = Math.max(0, Math.min(100, Number(data.contradictionScore) || 0));
        const aiProb = Math.max(1, Math.min(99, Number(data.aiProbability) || yesPct));
        return {
            relevant: data.relevant !== false,
            keyFinding: String(data.keyFinding || ''),
            evidenceType: (['official_document', 'direct_quote', 'expert_analysis', 'rumor'] as const).includes(data.evidenceType as never) ? data.evidenceType as AnalysisResult['evidenceType'] : 'expert_analysis',
            aiProbability: aiProb,
            direction: data.direction === 'YES' || data.direction === 'NO' ? data.direction : 'NONE',
            contradictionScore: score,
            confidence: data.confidence === 'High' || data.confidence === 'Medium' ? data.confidence : 'Low',
            tier: score >= 80 ? 1 : score >= 60 ? 2 : 3,
            timeAdvantageHours: Math.max(0, Number(data.timeAdvantageHours) || 0),
            reasoning: String(data.reasoning || ''),
            model
        };
    } catch (error) {
        console.error('AI analysis failed:', (error as Error).message);
        return null;
    }
}
