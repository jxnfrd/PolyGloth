import { PolymarketMarket } from './polymarket';
import { askJson } from './llm';

/**
 * "Pure AI" estimate: the model's probability for a market from the question,
 * resolution rules and the current price alone. Stored next to the market price so
 * the estimate can be scored against resolution later (see scripts/backtest-pure-ai.ts).
 */
export interface PureAIPrediction {
    market_id: string;
    market_slug: string;
    market_question: string;
    market_yes_price: number;
    summary: string;
    reasoning: string;
    estimatedProbability: number;
    confidence_level: 'high' | 'medium' | 'low';
    ai_model_used: string;
}

function buildPrompt(market: PolymarketMarket): string {
    const yesPct = Math.round(market.yesPrice * 100);
    return `
You are a calibrated forecaster. Estimate the probability that this prediction market resolves to "${market.outcomes[0] || 'Yes'}".

MARKET QUESTION: "${market.question}"
RESOLUTION RULES: "${market.description.slice(0, 1500)}"
OUTCOMES: ${JSON.stringify(market.outcomes)}
CURRENT MARKET PRICE: ${yesPct}% (this is the crowd's estimate; only deviate with a concrete reason)
CLOSES: ${market.endDate}
TODAY: ${new Date().toISOString().slice(0, 10)}

Return ONLY this JSON object:
{
  "summary": "1-2 sentence forecast",
  "reasoning": "step-by-step: base rate, what would have to happen, key uncertainties",
  "estimatedProbability": number between 1 and 99,
  "confidence": "high" | "medium" | "low"
}`;
}

export async function generatePureAIPrediction(market: PolymarketMarket): Promise<PureAIPrediction | null> {
    try {
        const { data, model } = await askJson<{ summary?: string; reasoning?: string; estimatedProbability?: number; confidence?: string }>(buildPrompt(market));
        const p = Number(data.estimatedProbability);
        if (!data.summary || !data.reasoning || !Number.isFinite(p)) {
            console.error(`Invalid JSON from ${model}:`, JSON.stringify(data).slice(0, 200));
            return null;
        }
        return {
            market_id: market.id,
            market_slug: market.slug,
            market_question: market.question,
            market_yes_price: market.yesPrice,
            summary: data.summary,
            reasoning: data.reasoning,
            estimatedProbability: Math.max(1, Math.min(99, Math.round(p))),
            confidence_level: data.confidence === 'high' || data.confidence === 'low' ? data.confidence : 'medium',
            ai_model_used: model
        };
    } catch (e) {
        console.error('Pure AI prediction failed:', (e as Error).message);
        return null;
    }
}
