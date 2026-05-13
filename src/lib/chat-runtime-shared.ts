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

/**
 * Phase 0.5 Slice E.1 (2026-05-13) — `ChatRuntime` is now an alias of
 * the canonical `RuntimeId` from `runtime/runtime-id.ts`. Adding a
 * new runtime (Codex / Gemini / …) goes through `RUNTIME_IDS` in
 * runtime-id.ts; every consumer of `ChatRuntime` automatically picks
 * it up. The legacy two-state union was Codex's P1 finding —
 * hand-rolled string-literal blocked Codex Runtime from being added
 * with a single-place edit.
 */
import { isRuntimeId, type RuntimeId, type RuntimeIdParam } from './runtime/runtime-id';

export type ChatRuntime = RuntimeId;

/** Wire form for HTTP query params — adds 'auto' (server resolves). */
export type ChatRuntimeParam = RuntimeIdParam;

/** Type guard for parsing untrusted query strings. */
export function isChatRuntimeParam(v: unknown): v is ChatRuntimeParam {
  return v === 'auto' || isRuntimeId(v);
}

/**
 * Phase 2 Step 3b — client-safe translator from a session's stored
 * `runtime_pin` to a `ChatRuntimeParam`. Used by ChatView /
 * MessageInput / picker to pass an explicit runtime into
 * `useProviderModels`, instead of the old `'auto'` default that made
 * the server resolve via the global `agent_runtime` setting (drift
 * point #4 from the Phase 2 Step 1 audit).
 *
 *   pin = <known RuntimeId>        → that RuntimeId  (session pinned)
 *   pin = '' / undefined / unknown → 'auto'          (follow global)
 *
 * Pure: no DB, no React, no Node-only deps. Safe to import from any
 * client component or server caller.
 */
export function chatRuntimeParamForSession(runtimePin: string | undefined | null): ChatRuntimeParam {
  if (runtimePin && isRuntimeId(runtimePin)) {
    return runtimePin;
  }
  return 'auto';
}
