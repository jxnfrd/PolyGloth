import OpenAI from 'openai';
import { PolymarketMarket } from "./polymarket";

export interface PureAIPrediction {
    market_id: string;
    market_slug?: string;
    summary: string;
    reasoning: string;
    estimatedProbability: number;
    confidence: "high" | "medium" | "low";
    ai_model_used: string;
}

export async function generatePureAIPrediction(market: PolymarketMarket): Promise<PureAIPrediction | null> {
    const API_KEY = process.env.OPENAI_API_KEY;
    if (!API_KEY) {
        console.error("Missing OPENAI_API_KEY for Pure AI Analyst");
        return null; // Fail gracefully
    }

    const openai = new OpenAI({
        apiKey: API_KEY,
    });

    const prompt = `
  You are a prediction market analyst. Analyze the following betting market and provide your estimation.

  MARKET QUESTION: "${market.question}"
  DESCRIPTION: "${market.description}"
  LIQUIDITY: ${market.liquidity} USD
  END DATE: ${market.endDate}

  Provide your analysis in the following STRICT JSON format:
  {
    "summary": "A 1-2 sentence prediction of the most likely outcome.",
    "reasoning": "A step-by-step explanation of your thinking, considering the context, plausible scenarios, and common sense.",
    "estimatedProbability": A number between 1 and 99 representing the percentage chance the "Yes" outcome occurs.,
    "confidence": "high", "medium", or "low" based on the clarity of the question and available information.
  }
  `;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that outputs strictly JSON."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            response_format: { type: "json_object" }
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error("Empty response from OpenAI");

        const prediction = JSON.parse(content);

        // Validation
        if (!prediction.summary || !prediction.reasoning || typeof prediction.estimatedProbability !== 'number') {
            throw new Error("Invalid JSON structure from AI");
        }

        return {
            market_id: market.id,
            market_slug: market.slug || undefined,
            summary: prediction.summary,
            reasoning: prediction.reasoning,
            estimatedProbability: prediction.estimatedProbability,
            confidence: prediction.confidence || "medium",
            ai_model_used: "gpt-4o"
        };

    } catch (error) {
        console.error(`Pure AI analysis failed for market ${market.id}:`, error);
        return null;
    }
}
