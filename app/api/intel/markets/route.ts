import { checkApiKey, ok, fail, params } from '@/lib/ops/api';
import { searchMarketsTool } from '@/lib/ops/mcp-tools';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
/** GET /api/intel/markets?q=fed&category=economy&state=open|resolved|all&order=volume24hr|volume|end_ts&limit=50 */
export async function GET(request: Request) {
    const denied = checkApiKey(request); if (denied) return denied;
    try { const p = params(request); return ok(searchMarketsTool({ q: p.q, category: p.category ?? p.cat, state: p.state, order: p.order, limit: p.limit ?? 50 }), { params: p }); }
    catch (e) { return fail(e, 500); }
}
