import { checkApiKey, ok, fail, params } from '@/lib/ops/api';
import { recentSignalsTool } from '@/lib/ops/mcp-tools';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
/** GET /api/intel/signals?type=consensus&since=<unix>&limit=100 */
export async function GET(request: Request) {
    const denied = checkApiKey(request); if (denied) return denied;
    try { const p = params(request); return ok(recentSignalsTool({ type: p.type, since: p.since, limit: p.limit ?? 100 }), { params: p }); }
    catch (e) { return fail(e, 500); }
}
