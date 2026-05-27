/**
 * Registry of CodePilot built-in MCP servers that are served to Codex over
 * the streamable-HTTP route (`/api/codex/mcp/[server]`). Phase 8 #31.
 *
 * Each entry knows how to (a) build a fresh in-process MCP server instance
 * per request (stateless) by reusing the SAME `createSdkMcpServer` the
 * ClaudeCode path uses — no duplicated tool logic, (b) authorize the HTTP
 * request, and (c) declare the elicitation policy for the model's
 * autonomous tool-call approval.
 *
 * Two independent per-server policies:
 *   - `authorize` (HTTP serving): memory reads workspace files → MUST be
 *     scoped to the configured assistant workspace; widget/tasks read no
 *     files → localhost trust.
 *   - `elicitationPolicy` (tool-call approval, Phase 8 #31): Codex sends an
 *     `mcpServer/elicitation/request` to approve each model-initiated tool
 *     call. Safe-read servers (memory, widget) `auto_accept`; servers with
 *     mutating / side-effecting tools (tasks: schedule/cancel/notify) need
 *     `user_approval` — route to the user, never auto-run.
 */

import { createMemorySearchMcpServer } from '@/lib/memory-search-mcp';
import { createWidgetMcpServer } from '@/lib/widget-guidelines';
import { createNotificationMcpServer } from '@/lib/notification-mcp';
import { getSetting } from '@/lib/db';
import { sameRealPath } from './mcp-config';

/** The connectable MCP server (the `.instance` of a `createSdkMcpServer`). */
type CodexBuiltinMcpInstance = ReturnType<typeof createWidgetMcpServer>['instance'];

export type BuiltinMcpAuth =
  | { ok: true }
  | { ok: false; status: number; message: string };

/** Tool-call approval policy for a built-in server's elicitation. */
export type ElicitationPolicy = 'auto_accept' | 'user_approval';

export interface BuiltinMcpRouteCtx {
  workspacePath: string;
  sessionId: string;
}

export interface BuiltinMcpServerEntry {
  /** Codex `mcp_servers` namespace + route path segment. */
  readonly serverName: string;
  /** Tool-call approval policy (see module doc). */
  readonly elicitationPolicy: ElicitationPolicy;
  /** Build a fresh server instance for one stateless request. */
  create(ctx: BuiltinMcpRouteCtx): CodexBuiltinMcpInstance;
  /** Authorize the HTTP request before serving. */
  authorize(ctx: BuiltinMcpRouteCtx): BuiltinMcpAuth;
}

function authorizeAssistantWorkspace(workspacePath: string): BuiltinMcpAuth {
  const configured = getSetting('assistant_workspace_path');
  if (!configured || configured.trim() === '') {
    return { ok: false, status: 403, message: 'No assistant workspace configured' };
  }
  return sameRealPath(workspacePath, configured)
    ? { ok: true }
    : { ok: false, status: 403, message: 'Workspace not authorized for this MCP' };
}

export const CODEX_BUILTIN_MCP_SERVERS: Readonly<Record<string, BuiltinMcpServerEntry>> = {
  codepilot_memory: {
    serverName: 'codepilot_memory',
    elicitationPolicy: 'auto_accept', // read-only memo reads (auto_safe)
    create: ({ workspacePath }) => createMemorySearchMcpServer(workspacePath).instance,
    authorize: ({ workspacePath }) => authorizeAssistantWorkspace(workspacePath),
  },
  codepilot_widget: {
    serverName: 'codepilot_widget',
    elicitationPolicy: 'auto_accept', // static read-only guidelines text
    create: () => createWidgetMcpServer().instance,
    authorize: () => ({ ok: true }), // no file access, no workspace scope
  },
  codepilot_tasks: {
    serverName: 'codepilot_tasks',
    // schedule_task / cancel_task (mutating) + notify (side-effect) → the
    // model's call must be approved by the user, never auto-run.
    elicitationPolicy: 'user_approval',
    create: ({ workspacePath, sessionId }) =>
      createNotificationMcpServer({ sessionId, workingDirectory: workspacePath }).instance,
    // No file reads; tasks are scoped by sessionId/workspace passed at create.
    authorize: () => ({ ok: true }),
  },
};

export function getBuiltinMcpServer(serverName: string): BuiltinMcpServerEntry | undefined {
  return CODEX_BUILTIN_MCP_SERVERS[serverName];
}
