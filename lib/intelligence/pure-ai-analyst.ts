import OpenAI from 'openai';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PolymarketMarket } from "./polymarket";

export interface PureAIPrediction {
    market_id: string;
    market_slug?: string;
    summary: string;
    reasoning: string;
    estimatedProbability: number;
    confidence_level: "high" | "medium" | "low";
    ai_model_used: string;
}

// --- PROMPT GENERATOR ---
function generatePrompt(market: PolymarketMarket): string {
    return `
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
}

// --- PROVIDER 1: OPENAI ---
async function tryOpenAI(prompt: string): Promise<{ data: any, model: string } | null> {
    const API_KEY = process.env.OPENAI_API_KEY;
    if (!API_KEY) return null;

    try {
        const openai = new OpenAI({ apiKey: API_KEY });
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a helpful assistant that outputs strictly JSON." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });
        const content = response.choices[0].message.content;
        return content ? { data: JSON.parse(content), model: 'gpt-4o' } : null;
    } catch (e) {
        console.error("OpenAI Failed:", e);
        return null;
    }
}

// --- PROVIDER 2: GEMINI ---
async function tryGemini(prompt: string): Promise<{ data: any, model: string } | null> {
    const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!API_KEY) return null;

    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return { data: JSON.parse(cleanJson), model: 'gemini-1.5-flash' };
    } catch (e) {
        console.error("Gemini Failed:", e);
        return null;
    }
}

// --- PROVIDER 3: OPENROUTER ---
async function tryOpenRouter(prompt: string): Promise<{ data: any, model: string } | null> {
    const API_KEY = process.env.OPENROUTER_API_KEY;
    if (!API_KEY) {
        console.log("No OpenRouter Key found.");
        return null;
    }

    try {
        const openai = new OpenAI({
            apiKey: API_KEY,
            baseURL: "https://openrouter.ai/api/v1"
        });

        // Using Gemini 2.0 Flash Exp via OpenRouter (User Requested / Reliable Free Tier)
        const response = await openai.chat.completions.create({
            model: "google/gemini-2.0-flash-exp:free",
            messages: [
                { role: "system", content: "You are a helpful assistant that outputs strictly JSON." },
                { role: "user", content: prompt }
            ]
        });

        const content = response.choices[0].message.content;
        if (!content) return null;

        const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
        return { data: JSON.parse(cleanContent), model: 'openrouter/gemini-2.0-flash' };
    } catch (e: any) {
        console.log(`OpenRouter Failed: ${e.message}`);
        if (e.response) console.log(JSON.stringify(e.response.data));
        return null;
    }
}

// --- MAIN ORCHESTRATOR ---
export async function generatePureAIPrediction(market: PolymarketMarket): Promise<PureAIPrediction | null> {
    const prompt = generatePrompt(market);

    let result = await tryOpenAI(prompt);

    if (!result) {
        console.log("⚠️ OpenAI failed. Falling back to Gemini...");
        result = await tryGemini(prompt);
    }

    if (!result) {
        console.log("⚠️ Gemini failed. Falling back to OpenRouter...");
        result = await tryOpenRouter(prompt);
    }

    if (!result) {
        console.error("❌ ALL AI Providers failed.");
        return null;
    }

    const { data: prediction, model } = result;

    // Validate
    if (!prediction.summary || !prediction.reasoning || typeof prediction.estimatedProbability !== 'number') {
        console.error(`Invalid JSON from ${model}`);
        return null;
    }

    return {
        market_id: market.id,
        market_slug: market.slug || undefined,
        summary: prediction.summary,
        reasoning: prediction.reasoning,
        estimatedProbability: prediction.estimatedProbability,
        confidence_level: prediction.confidence || "medium",
        ai_model_used: model
    };
}
