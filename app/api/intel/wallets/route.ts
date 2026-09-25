import { checkApiKey, ok, fail, params } from '@/lib/ops/api';
import { topWalletsTool } from '@/lib/ops/mcp-tools';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
/** GET /api/intel/wallets?cat=all&win=0&order=best|worst&min=30&limit=50 */
export async function GET(request: Request) {
    const denied = checkApiKey(request); if (denied) return denied;
    try {
        const p = params(request);
        return ok(topWalletsTool({ category: p.cat, windowDays: p.win, order: p.order, minResolved: p.min, limit: p.limit }), { params: p });
    } catch (e) { return fail(e, 500); }
}
