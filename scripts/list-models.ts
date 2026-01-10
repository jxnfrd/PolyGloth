import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { GoogleGenerativeAI } from '@google/generative-ai';

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
    try {
        // Direct access to model list via fetch if SDK doesn't expose it easily, 
        // but SDK usually doesn't have listModels on the main class in older versions?
        // Actually recent SDK has it? No, standard is usually via specialized client or HTTP.
        // Let's try to infer if we can make a raw request or use a known model.
        // But wait, the error message literally says: "Call ListModels to see the list..."
        // The SDK doesn't export a `listModels` function easily on the generic client in some versions.
        // I'll try to just check if I can use 'gemini-pro' without 'models/' prefix? 
        // SDK adds 'models/' prefix automatically usually.

        console.log('Testing raw fetch to list models...');
        const key = process.env.GOOGLE_API_KEY;
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const data = await response.json();
        console.log('Available Models:', data.models?.map((m: any) => m.name));

    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
