```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PolymarketMarket } from './polymarket';
import { StandardizedContext } from './types/sources';

const MOCK_API_KEY = process.env.GOOGLE_API_KEY || "YOUR_GEMINI_KEY";

// Assuming AnalysisResult is defined elsewhere or will be defined.
// For the purpose of this edit, we'll use 'any' if AnalysisResult is not provided.
type AnalysisResult = any;

export async function analyzeContradiction(
    market: PolymarketMarket,
    evidence: { title: string, source: string, date: string, snippet?: string },
    financialContext?: StandardizedContext
): Promise<AnalysisResult | null> {
    try {
        const genAI = new GoogleGenerativeAI(MOCK_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        // Formatting Context for Prompt
        let contextString = "";
        if (financialContext) {
            if (financialContext.fundamentals?.length) {
                contextString += "\nFUNDAMENTALS:\n" + financialContext.fundamentals.map(f => `- ${ f.symbol }: Price $${ f.latestPrice }, P / E ${ f.keyStats.peRatio } `).join("\n");
            }
            if (financialContext.economics?.length) {
                contextString += "\nMACRO DATA:\n" + financialContext.economics.map(e => `- ${ e.title }: ${ e.latestValue } (${ e.date })`).join("\n");
            }
            if (financialContext.newsSentiment?.length) {
                contextString += "\nSENTIMENT:\n" + financialContext.newsSentiment.join("\n");
            }
        }

        const prompt = `
        ACT AS: A Senior Financial Analyst & Contrarian Signal Detector.

    TASK: Analyze if the provided "Recent News/Evidence" contradicts the "Prediction Market Question".

        MARKET: "${market.question}"

EVIDENCE:
Title: "${evidence.title}"
Source: "${evidence.source}"
Date: "${evidence.date}"
        
        ADDITIONAL CONTEXT(Real - time Data):
        ${ contextString || "No specific financial data fetched." }
        
        ** Your Task:**
    Analyze if this news article contradicts the current market assumption.
        
        ** Scoring Framework:**
    1. ** Freshness(0 - 30):** Is this breaking news ?
        2. ** Source Quality(0 - 25):** Tier 1 outlet or official govt source ?
            3. ** Evidence Clarity(0 - 25):** Direct quote > Paraphrase > Speculation.
        4. ** Language Advantage(0 - 20):** Is this hard to find in English ?
        
        ** Signal Tiers:**
        - ** Tier 1(80 + pts):** High Confidence Contradiction(Trade Signal)
    - ** Tier 2(60 - 79 pts):** Moderate Divergence(Watchlist)
        - ** Tier 3(<60 pts):** Information Context(Noise)

        Return ONLY a JSON object:
{
    "keyFinding": "One powerful sentence summary",
        "evidenceType": "official_document" | "direct_quote" | "expert_analysis" | "rumor",
            "contradictionScore": number(0 - 100),
                "confidence": "High" | "Medium" | "Low",
                    "tier": 1 | 2 | 3,
                        "timeAdvantageHours": number(estimated),
                            "reasoning": "Brief explanation of the score"
}
`;

        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        // Robust JSON extraction
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }

        try {
            return JSON.parse(jsonMatch[0]);
        } catch (e) {
            // Last resort: simple cleanup
            const simpleClean = text.replace(/```json / g, '').replace(/```/g, '').trim();
return JSON.parse(simpleClean);
        }
    } catch (error) {
    console.error('AI Analysis failed:', error);
    return null;
}
}
