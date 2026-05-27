/**
 * Codex MCP elicitation policy — Phase 8 Phase 5.
 *
 * Under `approvalPolicy: on-request`, Codex sends an MCP tool-call APPROVAL
 * to the client as a `mcpServer/elicitation/request` (server→client). The
 * Phase 5 login smoke's root cause was a blanket DECLINE here: every
 * autonomous `codepilot_memory_*` call came back as Codex's
 * "user rejected MCP tool call".
 *
 * Policy: the CodePilot Memory MCP is read-only (auto_safe mutationLevel),
 * so its elicitation is ACCEPTED — the model may read memory without a
 * prompt. Any OTHER server is a safe DECLINE: we have no UI to fill a real
 * elicitation form, and no permission policy to approve other servers'
 * (possibly mutating) tools yet. That gate is the work tracked for the
 * remaining capabilities (Widget / Tasks / Image / Media / user MCP).
 *
 * This is a pure decision function so it can be unit-tested directly —
 * the regression we must prevent is "someone flips it back to blanket
 * decline (or, worse, blanket accept)".
 */

import { CODEX_MEMORY_MCP_SERVER_NAME, CODEX_WIDGET_MCP_SERVER_NAME } from './mcp-config';

/** Shape of `McpServerElicitationRequestResponse` (codex 0.133 v2). */
export interface CodexElicitationResponse {
  action: 'accept' | 'decline';
  content: Record<string, never> | null;
  _meta: null;
}

/**
 * Built-in MCP servers whose tool-call approval elicitation we auto-accept.
 * ONLY safe-read built-ins (Memory = workspace memo reads, Widget = static
 * guidelines text). Mutating / side-effecting servers must NOT be added here
 * — they need mutationLevel / permission policy first (#31).
 */
const AUTO_ACCEPT_ELICITATION_SERVERS: ReadonlySet<string> = new Set([
  CODEX_MEMORY_MCP_SERVER_NAME,
  CODEX_WIDGET_MCP_SERVER_NAME,
]);

/**
 * Decide how to answer a Codex MCP elicitation, given the originating MCP
 * server name. Accept only the safe-read built-in servers; decline everything
 * else (the safe default — never blanket-accept).
 */
export function decideCodexElicitation(
  serverName: string | null | undefined,
): CodexElicitationResponse {
  if (serverName && AUTO_ACCEPT_ELICITATION_SERVERS.has(serverName)) {
    return { action: 'accept', content: {}, _meta: null };
  }
  return { action: 'decline', content: null, _meta: null };
}
