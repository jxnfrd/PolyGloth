import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { GoogleGenerativeAI } from "@google/generative-ai";

async function testAI() {
    console.log('🤖 Testing Google Gemini AI...');

    if (!process.env.GOOGLE_API_KEY) {
        console.error('❌ GOOGLE_API_KEY is MISSING from env!');
        return;
    }
    console.log('✅ GOOGLE_API_KEY found.');

    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        console.log('📤 Sending prompt...');
        const result = await model.generateContent("Return JSON: { \"status\": \"online\" }");
        const response = await result.response;
        const text = response.text();

        console.log('📥 Response:', text);
        console.log('✅ AI Test Passed!');
    } catch (error) {
        console.error('❌ AI Test FAILED:', error);
    }
}

testAI();
