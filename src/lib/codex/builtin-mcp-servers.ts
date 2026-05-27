/**
 * Registry of CodePilot built-in MCP servers that are served to Codex over
 * the streamable-HTTP route (`/api/codex/mcp/[server]`). Phase 8 #31.
 *
 * Each entry knows how to (a) build a fresh in-process MCP server instance
 * per request (stateless) by reusing the SAME `createSdkMcpServer` the
 * ClaudeCode path uses — no duplicated tool logic — and (b) authorize the
 * request. The route is generic; per-server policy lives here so adding the
 * next capability is a one-entry change.
 *
 * Auth policy is per-server because the access risk differs:
 *   - Memory reads workspace files → MUST be scoped to the configured
 *     assistant workspace (realpath equality), else a local process could
 *     point it at any directory.
 *   - Widget guidelines are static read-only text (no file/FS access) →
 *     localhost trust is sufficient, no workspace scoping.
 */

import { createMemorySearchMcpServer } from '@/lib/memory-search-mcp';
import { createWidgetMcpServer } from '@/lib/widget-guidelines';
import { getSetting } from '@/lib/db';
import { sameRealPath } from './mcp-config';

/** The connectable MCP server (the `.instance` of a `createSdkMcpServer`). */
type CodexBuiltinMcpInstance = ReturnType<typeof createWidgetMcpServer>['instance'];

export type BuiltinMcpAuth =
  | { ok: true }
  | { ok: false; status: number; message: string };

export interface BuiltinMcpServerEntry {
  /** Codex `mcp_servers` namespace + route path segment. */
  readonly serverName: string;
  /** Whether the server reads the assistant workspace (memory) or not (widget). */
  readonly needsWorkspace: boolean;
  /** Build a fresh server instance for one stateless request. */
  create(ctx: { workspacePath: string }): CodexBuiltinMcpInstance;
  /** Authorize the request before serving. */
  authorize(ctx: { workspacePath: string }): BuiltinMcpAuth;
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
    needsWorkspace: true,
    create: ({ workspacePath }) => createMemorySearchMcpServer(workspacePath).instance,
    authorize: ({ workspacePath }) => authorizeAssistantWorkspace(workspacePath),
  },
  codepilot_widget: {
    serverName: 'codepilot_widget',
    needsWorkspace: false,
    create: () => createWidgetMcpServer().instance,
    // Static read-only guidelines text — no file access, no workspace scope.
    authorize: () => ({ ok: true }),
  },
};

export function getBuiltinMcpServer(serverName: string): BuiltinMcpServerEntry | undefined {
  return CODEX_BUILTIN_MCP_SERVERS[serverName];
}
