import { checkApiKey, ok, fail } from '@/lib/ops/api';
import { dbStatsTool } from '@/lib/ops/mcp-tools';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    const denied = checkApiKey(request); if (denied) return denied;
    try { return ok(dbStatsTool()); } catch (e) { return fail(e, 500); }
}
