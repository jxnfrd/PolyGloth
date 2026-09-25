import { NextResponse } from 'next/server';

/**
 * Shared helpers for app/api/intel/* route handlers.
 * Auth: when INTEL_API_KEY is set, requests must send `x-api-key: <key>` (or `?api_key=`); otherwise open (localhost use).
 */
export function checkApiKey(request: Request): NextResponse | null {
    const required = process.env.INTEL_API_KEY;
    if (!required) return null;
    const given = request.headers.get('x-api-key') || new URL(request.url).searchParams.get('api_key') || '';
    return given === required ? null : NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export function ok(data: unknown, extra: Record<string, unknown> = {}) {
    return NextResponse.json({ ok: true, data, generatedAt: new Date().toISOString(), ...extra });
}

export function fail(error: unknown, status = 400) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error), generatedAt: new Date().toISOString() }, { status });
}

export function params(request: Request): Record<string, string> {
    return Object.fromEntries(new URL(request.url).searchParams.entries());
}
