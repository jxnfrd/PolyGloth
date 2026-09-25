import { checkApiKey, ok, fail, params } from '@/lib/ops/api';
import { arbOpportunitiesTool } from '@/lib/ops/mcp-tools';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export const maxDuration = 120;
/** GET /api/intel/arb?minEdge=0.01&limit=50&live=1   (live=1 re-scans Gamma/CLOB/Kalshi and writes signals; slow) */
export async function GET(request: Request) {
    const denied = checkApiKey(request); if (denied) return denied;
    try { const p = params(request); return ok(await arbOpportunitiesTool({ live: p.live, minEdge: p.minEdge, limit: p.limit }), { params: p }); }
    catch (e) { return fail(e, 500); }
}
