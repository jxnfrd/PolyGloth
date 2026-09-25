import { NextResponse } from 'next/server';

/**
 * Cron endpoints were public (audit 2026-09-25): anyone could trigger scraping and DB writes.
 * Require CRON_SECRET via `Authorization: Bearer <secret>` (Vercel Cron convention) or `?key=<secret>`
 * (cron-job.org convention). With CRON_SECRET unset the endpoints refuse to run.
 */
export function authorizeCron(request: Request): NextResponse | null {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    const header = request.headers.get('authorization') || '';
    const key = new URL(request.url).searchParams.get('key') || '';
    if (header === `Bearer ${secret}` || key === secret) return null;
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
