// dotenv must stay silent: stdout is the MCP protocol channel.
import { config } from 'dotenv'; config({ path: '.env.local', quiet: true });
import * as readline from 'node:readline';
import { openDb } from '../lib/pm/db';
import { TOOL_DEFS, callTool } from '../lib/ops/mcp-tools';

/**
 * PolyGloth MCP server (stdio, JSON-RPC 2.0, newline-delimited) — no SDK dependency.
 * Implements: initialize, notifications/initialized, ping, tools/list, tools/call.
 * Register with Claude Code:   claude mcp add polygloth -- npx tsx scripts/pm-mcp.ts
 * (run from the repo root so data/polygloth.sqlite resolves; or set POLYGLOTH_DB to an absolute path).
 * Logs go to stderr only; stdout is the protocol channel.
 */
const PROTOCOL_VERSION = '2024-11-05';
const log = (m: string) => process.stderr.write(`[pm-mcp ${new Date().toISOString().slice(11, 19)}] ${m}\n`);

interface Req { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, unknown> }

function reply(id: Req['id'], result: unknown) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function replyError(id: Req['id'], code: number, message: string, data?: unknown) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } }) + '\n'); }

async function handle(req: Req) {
    const { id, method } = req;
    const p = req.params ?? {};
    switch (method) {
        case 'initialize':
            return reply(id, { protocolVersion: typeof p.protocolVersion === 'string' ? p.protocolVersion : PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'polygloth', version: '2.0.0' }, instructions: 'Read-only analytics over the local PolyGloth SQLite store (Polymarket + Kalshi). Wallet addresses are 0x… proxy wallets; market ids are 0x… conditionIds. arb_opportunities with live=true hits the network.' });
        case 'notifications/initialized':
        case 'notifications/cancelled':
            return; // notifications carry no id and get no reply
        case 'ping':
            return reply(id, {});
        case 'tools/list':
            return reply(id, { tools: TOOL_DEFS });
        case 'tools/call': {
            const name = String(p.name ?? '');
            const args = (p.arguments ?? {}) as Record<string, unknown>;
            try {
                const result = await callTool(name, args);
                return reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false });
            } catch (e) {
                return reply(id, { content: [{ type: 'text', text: `error: ${(e as Error).message}` }], isError: true });
            }
        }
        case 'resources/list': return reply(id, { resources: [] });
        case 'prompts/list': return reply(id, { prompts: [] });
        default:
            if (id === undefined || id === null) return; // unknown notification
            return replyError(id, -32601, `method not found: ${method}`);
    }
}

(async () => {
    openDb();
    log(`ready · db ${process.env.POLYGLOTH_DB || 'data/polygloth.sqlite'} · ${TOOL_DEFS.length} tools`);
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    let chain: Promise<unknown> = Promise.resolve();
    rl.on('line', line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let req: Req;
        try { req = JSON.parse(trimmed); } catch { replyError(null, -32700, 'parse error'); return; }
        // Serialize handling so tool calls never interleave on the single SQLite connection.
        chain = chain.then(() => handle(req)).catch(e => { log(`handler error: ${(e as Error).message}`); if (req.id !== undefined) replyError(req.id, -32603, (e as Error).message); });
    });
    rl.on('close', () => { chain.finally(() => process.exit(0)); });
})().catch(e => { log(String(e)); process.exit(1); });
