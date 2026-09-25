import { checkApiKey, ok, fail, params } from '@/lib/ops/api';
import { walletReportTool } from '@/lib/ops/mcp-tools';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
/** GET /api/intel/wallets/0x…?trades=50 */
export async function GET(request: Request, { params: p }: { params: { address: string } }) {
    const denied = checkApiKey(request); if (denied) return denied;
    try { const q = params(request); const r = walletReportTool({ address: p.address, trades: q.trades ?? 200 }); return r.wallet ? ok(r) : fail(`wallet ${p.address} not ingested`, 404); }
    catch (e) { return fail(e); }
}
