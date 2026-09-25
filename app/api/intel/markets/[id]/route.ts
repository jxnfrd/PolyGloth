import { checkApiKey, ok, fail, params } from '@/lib/ops/api';
import { marketDetailTool } from '@/lib/ops/mcp-tools';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
/** GET /api/intel/markets/0x<conditionId>?trades=100&comments=20 */
export async function GET(request: Request, { params: p }: { params: { id: string } }) {
    const denied = checkApiKey(request); if (denied) return denied;
    try { const q = params(request); const d = marketDetailTool({ conditionId: p.id, trades: q.trades ?? 100, comments: q.comments ?? 20 }); return d ? ok(d) : fail(`market ${p.id} not in store`, 404); }
    catch (e) { return fail(e); }
}
