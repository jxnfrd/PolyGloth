import { GoogleGenerativeAI } from "@google/generative-ai";

export async function analyzeContradiction(market: any, article: any): Promise<any> {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `
        You are a **Forensic News Analyst**. Your job is to detect INFORMATION ASYMMETRY between local news and US Prediction Markets.
        
        **Market:** "${market.question}"
        **News Source:** "${article.title}" (Date: ${article.date}, Source: ${article.source})
        
        **Your Task:**
        Analyze if this news article contradicts the current market assumption.
        
        **Scoring Framework:**
        1. **Freshness (0-30):** Is this breaking news?
        2. **Source Quality (0-25):** Tier 1 outlet or official govt source?
        3. **Evidence Clarity (0-25):** Direct quote > Paraphrase > Speculation.
        4. **Language Advantage (0-20):** Is this hard to find in English?
        
        **Signal Tiers:**
        - **Tier 1 (80+ pts):** High Confidence Contradiction (Trade Signal)
        - **Tier 2 (60-79 pts):** Moderate Divergence (Watchlist)
        - **Tier 3 (<60 pts):** Information Context (Noise)

        Return ONLY a JSON object:
        {
            "keyFinding": "One powerful sentence summary",
            "evidenceType": "official_document" | "direct_quote" | "expert_analysis" | "rumor",
            "contradictionScore": number (0-100),
            "confidence": "High" | "Medium" | "Low",
            "tier": 1 | 2 | 3,
            "timeAdvantageHours": number (estimated),
            "reasoning": "Brief explanation of the score"
        }
        `;

        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        // Clean markdown code blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();

        return JSON.parse(jsonStr);
    } catch (error) {
        console.error('AI Analysis failed:', error);
        return null;
    }
}
