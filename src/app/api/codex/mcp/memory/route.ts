/**
 * CodePilot Memory MCP — streamable-HTTP route for Codex.
 *
 * Phase 8 Phase 1. The Memory MCP (`memory-search-mcp.ts`) is an
 * in-process Claude-SDK server that can't be spawned as a subprocess.
 * Instead we expose it here as a streamable-HTTP MCP endpoint on
 * CodePilot's own Next server, and point Codex at it via
 * `config.mcp_servers.codepilot_memory = { url, http_headers }`
 * (see `buildCodexMemoryMcpConfig` in `src/lib/codex/mcp-config.ts`).
 *
 * Reuse, not rewrite: `createMemorySearchMcpServer(ws).instance` is a
 * standard MCP `McpServer`, so we connect it straight to the SDK's
 * web-standard streamable-HTTP transport — the exact same tool logic the
 * ClaudeCode path uses, no duplicated search/get/recent implementation.
 *
 * Stateless: a fresh server + transport per request (no session state).
 * Validated against Codex 0.133 — see docs/research/codex-mcp-injection-poc/.
 *
 * Trust boundary: this is a localhost route, but ANY local process could
 * reach it. The workspace path arrives in a header, so the route MUST NOT
 * serve an arbitrary path — otherwise a local process could point the
 * header at any directory and read its files via codepilot_memory_get
 * (the tools scope reads to the given root, but the attacker chooses the
 * root). So we authorize the header against the configured
 * `assistant_workspace_path` (realpath equality); a mismatch is 403. This
 * reduces the route to "serves only the assistant workspace the user
 * already configured" — no more than the same-user FS access a local
 * process already has.
 */

import { type NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMemorySearchMcpServer } from '@/lib/memory-search-mcp';
import { getSetting } from '@/lib/db';
import { MEMORY_MCP_WORKSPACE_HEADER, sameRealPath } from '@/lib/codex/mcp-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The requested workspace is authorized only if it resolves to the same
 * real path as the configured assistant workspace. realpathSync throws on
 * a non-existent path → treated as unauthorized. When no assistant
 * workspace is configured, nothing is authorized (no legitimate caller).
 */
function isAuthorizedWorkspace(requested: string): boolean {
  const configured = getSetting('assistant_workspace_path');
  if (!configured || configured.trim() === '') return false;
  return sameRealPath(requested, configured);
}

function jsonRpcError(code: number, message: string, status: number): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const workspacePath = request.headers.get(MEMORY_MCP_WORKSPACE_HEADER) ?? '';
  if (workspacePath.trim() === '') {
    // -32602 invalid params: without a workspace we have nothing to serve.
    return jsonRpcError(-32602, `Missing ${MEMORY_MCP_WORKSPACE_HEADER} header`, 400);
  }
  if (!isAuthorizedWorkspace(workspacePath)) {
    // The header doesn't match the configured assistant workspace — refuse
    // rather than serve an attacker-chosen directory's memory files.
    return jsonRpcError(-32600, 'Workspace not authorized for the Memory MCP', 403);
  }

  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — one request, one response
      enableJsonResponse: true, // buffered JSON, no SSE stream to keep open
    });
    const { instance } = createMemorySearchMcpServer(workspacePath);
    await instance.connect(transport);
    return await transport.handleRequest(request);
  } catch (err) {
    return jsonRpcError(
      -32603,
      `Memory MCP route error: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}
