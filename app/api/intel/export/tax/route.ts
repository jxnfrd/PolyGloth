import { NextResponse } from 'next/server';
import { taxCsv } from '@/lib/report/journal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/intel/export/tax?country=US|ISO → CSV of closed/resolved paper orders (record export, not tax advice). */
export async function GET(request: Request) {
    const country = new URL(request.url).searchParams.get('country') || 'ISO';
    const csv = taxCsv(country);
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="polygloth-paper-trades-${country.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
