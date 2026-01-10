import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Temporary: Pass-through to allow site to load.
  // The Supabase auth logic was causing Edge Runtime crashes on Vercel.
  // Since dashboard data is public (RLS allows select for all), this is safe for viewing.
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
