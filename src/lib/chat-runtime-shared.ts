/**
 * chat-runtime-shared — pure types + helpers safe to import from
 * client components.
 *
 * Why this file exists separately from `chat-runtime.ts`:
 *
 *   `chat-runtime.ts` calls `resolveRuntime()` from `./runtime`, which
 *   transitively pulls in `runtime/sdk-runtime.ts → claude-client.ts`,
 *   and that module imports Node-only things (Sentry, OpenTelemetry,
 *   `child_process`, `fs`, `async_hooks`, …). Any client component
 *   that imports a value (not just a type) from `chat-runtime.ts`
 *   drags the whole server-side import graph into the client bundle
 *   and Next.js fails the build with `Module not found: Can't resolve
 *   'async_hooks'`.
 *
 *   So: the **pure** pieces (the type union + the type guard +
 *   `chatRuntimeParamForSession`) live here, with **zero** imports
 *   from `./runtime` or anything that touches a Node-only API. Client
 *   components import from `chat-runtime-shared`. Server-side callers
 *   keep importing from `chat-runtime` (which re-exports these names
 *   so existing call sites don't break).
 *
 *   Caught by Phase 2 Step 3b review (2026-05-07): a sandbox dev build
 *   threw at `ChatView.tsx → chat-runtime.ts → runtime/index.ts →
 *   sdk-runtime.ts → claude-client.ts → async_hooks`. Splitting the
 *   types/pure helpers off was the load-bearing fix.
 */

/** Two-state chat-side runtime label, aligned with ModelRuntimeCompat flags. */
export type ChatRuntime = 'claude_code' | 'codepilot_runtime';

/** Wire form for HTTP query params — adds 'auto' (server resolves). */
export type ChatRuntimeParam = ChatRuntime | 'auto';

/** Type guard for parsing untrusted query strings. */
export function isChatRuntimeParam(v: unknown): v is ChatRuntimeParam {
  return v === 'claude_code' || v === 'codepilot_runtime' || v === 'auto';
}

/**
 * Phase 2 Step 3b — client-safe translator from a session's stored
 * `runtime_pin` to a `ChatRuntimeParam`. Used by ChatView /
 * MessageInput / picker to pass an explicit runtime into
 * `useProviderModels`, instead of the old `'auto'` default that made
 * the server resolve via the global `agent_runtime` setting (drift
 * point #4 from the Phase 2 Step 1 audit).
 *
 *   pin = 'claude_code'        → 'claude_code'        (session pinned)
 *   pin = 'codepilot_runtime'  → 'codepilot_runtime'  (session pinned)
 *   pin = '' / undefined / unknown → 'auto'           (follow global)
 *
 * Pure: no DB, no React, no Node-only deps. Safe to import from any
 * client component or server caller.
 */
export function chatRuntimeParamForSession(runtimePin: string | undefined | null): ChatRuntimeParam {
  if (runtimePin === 'claude_code' || runtimePin === 'codepilot_runtime') {
    return runtimePin;
  }
  return 'auto';
}
