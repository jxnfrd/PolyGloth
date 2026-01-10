import { GoogleGenerativeAI } from "@google/generative-ai";
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
    const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!API_KEY) {
        console.error("Missing GOOGLE_API_KEY for Pure AI Analyst");
        return null; // Fail gracefully
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    // Use Flash for speed/cost efficiency as requested
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Basic JSON cleanup if model adds markdown blocks
        const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

        const prediction = JSON.parse(cleanJson);

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
            ai_model_used: "gemini-1.5-flash"
        };

    } catch (error) {
        console.error(`Pure AI analysis failed for market ${market.id}:`, error);
        return null;
    }
}
