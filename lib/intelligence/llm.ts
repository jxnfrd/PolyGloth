import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Single LLM entry point with provider fallback and env-configurable model names.
 *
 * Audit 2026-09-25: both keys in .env.local were dead (OpenAI 401, Gemini project has no
 * access to gemini-2.0/1.5/2.5-flash: 404 "no longer available to new users"), and the
 * model names were hard-coded in three places. Set:
 *   OPENAI_API_KEY   + OPENAI_MODEL   (default gpt-4o-mini)
 *   GOOGLE_API_KEY   + GEMINI_MODEL   (default gemini-2.5-flash)
 *   OPENROUTER_API_KEY + OPENROUTER_MODEL (default google/gemini-2.5-flash)
 * Order of attempts: OPENAI → GEMINI → OPENROUTER. Set LLM_PROVIDER=openai|gemini|openrouter to pin one.
 */

export interface LlmResult<T> { data: T; model: string; provider: 'openai' | 'gemini' | 'openrouter'; }

export class LlmUnavailableError extends Error {
    constructor(public attempts: string[]) { super(`No LLM provider succeeded: ${attempts.join(' | ')}`); }
}

export function extractJson<T = unknown>(text: string): T {
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON object in model output');
    return JSON.parse(m[0]) as T;
}

async function viaOpenAI<T>(prompt: string, system: string): Promise<LlmResult<T>> {
    const key = process.env.OPENAI_API_KEY; if (!key) throw new Error('OPENAI_API_KEY unset');
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const client = new OpenAI({ apiKey: key });
    const r = await client.chat.completions.create({
        model, temperature: 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
    });
    return { data: extractJson<T>(r.choices[0].message.content || ''), model, provider: 'openai' };
}

async function viaGemini<T>(prompt: string, system: string): Promise<LlmResult<T>> {
    const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY; if (!key) throw new Error('GOOGLE_API_KEY unset');
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const gen = new GoogleGenerativeAI(key).getGenerativeModel({ model, systemInstruction: system, generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } });
    const r = await gen.generateContent(prompt);
    return { data: extractJson<T>(r.response.text()), model, provider: 'gemini' };
}

async function viaOpenRouter<T>(prompt: string, system: string): Promise<LlmResult<T>> {
    const key = process.env.OPENROUTER_API_KEY; if (!key) throw new Error('OPENROUTER_API_KEY unset');
    const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
    const client = new OpenAI({ apiKey: key, baseURL: 'https://openrouter.ai/api/v1' });
    const r = await client.chat.completions.create({
        model, temperature: 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
    });
    return { data: extractJson<T>(r.choices[0].message.content || ''), model, provider: 'openrouter' };
}

const PROVIDERS = { openai: viaOpenAI, gemini: viaGemini, openrouter: viaOpenRouter } as const;

export async function askJson<T>(prompt: string, system = 'You are a careful analyst. Output strictly one JSON object and nothing else.'): Promise<LlmResult<T>> {
    const pinned = process.env.LLM_PROVIDER as keyof typeof PROVIDERS | undefined;
    const order = pinned && PROVIDERS[pinned] ? [pinned] : (['openai', 'gemini', 'openrouter'] as const);
    const attempts: string[] = [];
    for (const name of order) {
        try { return await PROVIDERS[name]<T>(prompt, system); }
        catch (e) { attempts.push(`${name}: ${(e as Error).message.slice(0, 160)}`); }
    }
    throw new LlmUnavailableError(attempts);
}
