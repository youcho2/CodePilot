/**
 * Runtime session reference store — Phase 0.5 Slice C (2026-05-13).
 *
 * Each runtime adapter owns its own session-side state. Today:
 *
 *   - `claude_code`        — backed by `chat_sessions.sdk_session_id`
 *                            column (legacy, preserved for back-compat
 *                            with v0.x history rows).
 *   - `codepilot_runtime`  — no external session state.
 *   - future `codex_runtime` — will add its own persistence (likely a
 *                              JSON `runtime_session_metadata` column
 *                              or a dedicated `runtime_session_refs`
 *                              table). The switch cases below grow
 *                              with each new runtime.
 *
 * UI / API code should call these helpers instead of reading
 * `session.sdk_session_id` directly. That keeps adapter-specific
 * fields scoped to this file so adding Codex Runtime later doesn't
 * mean splaying `codex_thread_id` across the chat / preview / panel
 * code paths.
 *
 * Cross-runtime invariant (codified in runtime-session-metadata.test.ts):
 * runtime switching on a chat session must NOT delete the metadata
 * of OTHER runtimes — only the runtime being switched out (or in)
 * has its ref touched. Today this is trivially true because each
 * runtime has its own backing column / table; the Codex slice will
 * add `clearRuntimeSessionRef` calls scoped per-runtime, not a global
 * "clear everything" sweep.
 */

import type { RuntimeId } from './runtime-id';
import type { RuntimeSessionRef } from './contract';
import { getSession, updateSdkSessionId } from '@/lib/db';

/**
 * Resolve the runtime-side session reference for a chat session
 * under a given runtime. Returns null when no session has been
 * established yet (e.g. fresh chat, or runtime that doesn't track
 * external state).
 */
export function getRuntimeSessionRef(
  chatSessionId: string,
  runtimeId: RuntimeId,
): RuntimeSessionRef | null {
  switch (runtimeId) {
    case 'claude_code': {
      const session = getSession(chatSessionId);
      if (!session?.sdk_session_id) return null;
      return { runtimeId: 'claude_code', token: session.sdk_session_id };
    }
    case 'codepilot_runtime':
      // Native runtime keeps state in-memory in the runtime singleton.
      // No persistent ref to surface.
      return null;
    case 'codex_runtime':
      // Phase 5 Phase 2 stub (2026-05-13). Phase 3 will replace this
      // with persistence backed by either a JSON `runtime_session_refs`
      // column or an in-memory map keyed by chat session — Codex
      // thread ids are required to resume an existing conversation
      // via `thread/resume`. Until the AgentRuntime adapter exists,
      // there's nothing to surface.
      return null;
    default: {
      // Exhaustiveness — when a new RuntimeId lands here, TS will fail
      // compilation forcing the implementer to add a case.
      const _: never = runtimeId;
      throw new Error(`getRuntimeSessionRef: unknown runtime ${String(_)}`);
    }
  }
}

/**
 * Persist the runtime-side session reference. Adapter is expected to
 * pass a `RuntimeSessionRef` whose `runtimeId` matches its own.
 */
export function setRuntimeSessionRef(
  chatSessionId: string,
  ref: RuntimeSessionRef,
): void {
  switch (ref.runtimeId) {
    case 'claude_code':
      updateSdkSessionId(chatSessionId, ref.token);
      return;
    case 'codepilot_runtime':
      // No-op — native runtime has no persistent ref.
      return;
    case 'codex_runtime':
      // Phase 5 Phase 2 stub — see getRuntimeSessionRef for context.
      // Phase 3 lands the persistence layer.
      return;
    default: {
      const _: never = ref.runtimeId;
      throw new Error(`setRuntimeSessionRef: unknown runtime ${String(_)}`);
    }
  }
}

/**
 * Clear the runtime-side session reference for one specific runtime.
 * Used when provider / model / runtime pin changes invalidate the
 * resume context (e.g. swapping the provider mid-session would let an
 * old SDK session id leak into a different provider).
 *
 * Only the named runtime's ref is touched — other runtimes' refs (if
 * any) are preserved. This is the cross-runtime metadata invariant.
 */
export function clearRuntimeSessionRef(
  chatSessionId: string,
  runtimeId: RuntimeId,
): void {
  switch (runtimeId) {
    case 'claude_code':
      updateSdkSessionId(chatSessionId, '');
      return;
    case 'codepilot_runtime':
      // No-op — nothing persisted.
      return;
    case 'codex_runtime':
      // Phase 5 Phase 2 stub — nothing persisted yet, Phase 3 lands
      // the clearing path alongside the persistence backend.
      return;
    default: {
      const _: never = runtimeId;
      throw new Error(`clearRuntimeSessionRef: unknown runtime ${String(_)}`);
    }
  }
}
