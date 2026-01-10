import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini 1.5 Flash lazily
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null;

function getModel() {
    if (!model) {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
        model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: { responseMimeType: "application/json" }
        });
    }
    return model;
}

export interface AnalysisResult {
    keyFinding: string;
    evidenceType: 'Anecdotal' | 'Statistical' | 'Expert Consensus' | 'Official Statement';
    contradictionScore: number; // 0-100
    confidence: 'High' | 'Medium' | 'Low';
}

// Define types for inputs
interface MarketEvent {
    question: string;
    description: string;
    outcomePrices: string; // JSON string
}

interface NewsArticleInput {
    title: string;
    source: string;
    date: string;
}

export async function analyzeContradiction(marketEvent: MarketEvent, newsArticle: NewsArticleInput): Promise<AnalysisResult | null> {
    const prompt = `
    You are a rigorous intelligence analyst.
    Your goal is to determine if the Foreign News Article contradicts the implied sentiment of the Prediction Market.
    
    Prediction Market:
    Question: "${marketEvent.question}"
    Description: "${marketEvent.description}"
    Current Outcome Prices: ${JSON.stringify(marketEvent.outcomePrices)}
    
    Foreign News Article:
    Title: "${newsArticle.title}"
    Source: "${newsArticle.source}"
    Date: "${newsArticle.date}"
    (Note: The article content matches keywords relevant to the market).

    Analyze:
    1. What is the market pricing in (e.g. "90% chance of X")?
    2. Does the news article provide new information that arguably changes those odds?
    3. Is there a contradiction?

    Return valid JSON ONLY matching this structure:
    {
        "keyFinding": "One sentence summary of the signal.",
        "evidenceType": "One of [Anecdotal, Statistical, Expert Consensus, Official Statement]",
        "contradictionScore": 0-100 (where 100 is total contradiction),
        "confidence": "High/Medium/Low"
    }
    `;

    try {
        const modelInstance = getModel();
        const result = await modelInstance.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        return JSON.parse(text) as AnalysisResult;
    } catch (error) {
        console.error('Error in analyzeContradiction:', error);
        return null; // Handle error gracefully
    }
}
