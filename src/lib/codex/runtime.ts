/**
 * Codex AgentRuntime implementation.
 *
 * Phase 5 Phase 3 (2026-05-13). Wires the existing CodePilot
 * `AgentRuntime` interface (stream / interrupt / isAvailable /
 * dispose) into the Codex app-server JSON-RPC channel.
 *
 * Lifecycle per call:
 *
 *   1. getCodexAppServer() — boot + initialize the app-server child
 *      process (cached singleton; subsequent calls reuse the same
 *      client).
 *   2. Resolve thread id — `thread/resume` if the session-store has
 *      a Codex ref for this chat session, else `thread/start` with
 *      the working directory.
 *   3. Subscribe to canonical notifications (agentMessage/delta,
 *      item/started, item/completed, turn/completed, etc.).
 *   4. `turn/start` with the user prompt + optional model override.
 *   5. Translate every notification into a `RuntimeRunEvent` via
 *      `translateCodexNotification`, then re-emit as SSE lines in
 *      CodePilot's existing format (`data: {"type":...,"data":...}\n\n`).
 *   6. On `turn/completed` (or `turn/failed`), close the stream.
 *
 * Server-to-client approval requests (`execCommandApproval` etc.)
 * are NOT wired into the canonical permission channel in this slice
 * — the JSON-RPC client doesn't yet support server-originated
 * requests, only notifications. Phase 6 closes that loop.
 *
 * NOTE: this module is node-only (pulls app-server-manager which
 * imports `child_process`). Don't import from client components.
 */

import type {
  AgentRuntime,
  RuntimeStreamOptions,
} from '@/lib/runtime/types';
import type { RuntimeRunEvent } from '@/lib/runtime/contract';
import {
  findCodexBinary,
  getCodexAppServer,
} from './app-server-manager';
import { translateCodexNotification } from './event-mapper';
import {
  getRuntimeSessionRef,
  setRuntimeSessionRef,
} from '@/lib/runtime/session-store';

/**
 * Convert one canonical RuntimeRunEvent into the SSE-line format the
 * existing chat consumers expect:
 *   `data: {"type":"<sdkType>","data":"<payload>"}\n\n`
 *
 * The chat side already knows how to render these (claude-client
 * has been emitting them for v0.x). Codex's translator hits the same
 * channel; consumers don't need a new code path.
 */
function canonicalToSseLine(event: RuntimeRunEvent): string {
  switch (event.type) {
    case 'assistant_delta':
      return `data: ${JSON.stringify({ type: 'text', data: event.text })}\n\n`;
    case 'tool_started':
      return `data: ${JSON.stringify({
        type: 'tool_use',
        data: JSON.stringify({ id: event.toolId, name: event.name, input: event.input ?? {} }),
      })}\n\n`;
    case 'tool_completed':
      return `data: ${JSON.stringify({
        type: 'tool_result',
        data: JSON.stringify({
          tool_use_id: event.toolId,
          content: event.output ?? '',
          ...(event.error ? { error: event.error } : {}),
        }),
      })}\n\n`;
    case 'command_started':
      return `data: ${JSON.stringify({
        type: 'tool_use',
        data: JSON.stringify({ id: event.commandId, name: 'Bash', input: { command: event.command, cwd: event.cwd } }),
      })}\n\n`;
    case 'file_changed':
      // Phase 5 Phase 4 (2026-05-13) — emit as the dedicated SSE
      // `file_changed` event type. `useSSEStream.handleSSEEvent` →
      // SSECallbacks.onFileChanged → stream-session-manager →
      // dispatchFileChanged → window 'codepilot:file-changed' event →
      // PreviewPanel quiet-refresh. Same downstream path the
      // ClaudeCode SDK isWriteTool inspection uses; the runtime
      // adapter is the only place that knows where the paths come
      // from.
      return `data: ${JSON.stringify({
        type: 'file_changed',
        data: JSON.stringify({ paths: event.paths }),
      })}\n\n`;
    case 'usage_updated':
      return `data: ${JSON.stringify({
        type: 'context_usage',
        data: JSON.stringify({
          input_tokens: event.inputTokens,
          output_tokens: event.outputTokens,
          model_context_window: event.contextWindow,
        }),
      })}\n\n`;
    case 'run_completed':
      return `data: ${JSON.stringify({ type: 'result', data: JSON.stringify({ finish_reason: event.finishReason ?? 'end_turn' }) })}\n\n`;
    case 'run_failed':
      return `data: ${JSON.stringify({ type: 'error', data: event.message })}\n\n`;
    case 'unknown_item':
      // Surface unknown items as status so the chat doesn't drop them.
      return `data: ${JSON.stringify({
        type: 'status',
        data: JSON.stringify({ kind: event.sourceType, payload: event.payload }),
      })}\n\n`;
    default: {
      const _: never = event;
      throw new Error(`canonicalToSseLine: unhandled event ${String(_)}`);
    }
  }
}

/**
 * Active Codex turn registry — Phase 5 Phase 4 Slice 3 (2026-05-13).
 *
 * `turn/interrupt` requires both `threadId` AND `turnId` per
 * upstream schema (`TurnInterruptParams = { threadId, turnId }`).
 * threadId is already persisted via session-store; turnId is
 * transient (one per send, valid until turn/completed). We keep it
 * in-process per chat session — losing it across process restart
 * is acceptable because turns don't survive restarts either.
 *
 * Map cleared when turn/completed or turn/failed lands.
 */
const activeCodexTurns = new Map<string, { threadId: string; turnId: string }>();

/**
 * The Codex AgentRuntime singleton. Phase 5 Phase 3 registers this
 * with the runtime registry alongside `nativeRuntime` and `sdkRuntime`.
 */
export const codexRuntime: AgentRuntime = {
  id: 'codex_runtime',
  displayName: 'Codex Runtime',
  description: 'Routes through the local codex app-server (Codex account models + native tools)',

  isAvailable(): boolean {
    return findCodexBinary() !== null;
  },

  stream(options: RuntimeStreamOptions): ReadableStream<string> {
    return new ReadableStream<string>({
      async start(controller) {
        const sessionId = options.sessionId;

        let active = true;
        const unsubscribers: Array<() => void> = [];
        const tryEnqueue = (line: string) => {
          if (!active) return;
          try {
            controller.enqueue(line);
          } catch {
            // Stream already closed (consumer aborted).
            active = false;
          }
        };

        const closeStream = (extra?: { error?: string }) => {
          if (!active) return;
          if (extra?.error) {
            tryEnqueue(
              `data: ${JSON.stringify({ type: 'error', data: extra.error })}\n\n`,
            );
          }
          tryEnqueue(`data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`);
          active = false;
          for (const u of unsubscribers.splice(0)) {
            try { u(); } catch { /* ignore */ }
          }
          try { controller.close(); } catch { /* ignore */ }
        };

        try {
          const { client } = await getCodexAppServer();

          // ── server-originated approval requests ──────────────────────
          // Codex emits item/commandExecution/requestApproval +
          // item/fileChange/requestApproval + item/permissions/requestApproval
          // as JSON-RPC REQUESTS (not notifications). The client must
          // respond or the turn hangs.
          //
          // Phase 5 review round 1 (2026-05-13) intermediate stance:
          // we register decline-by-default handlers for the canonical
          // approval methods + legacy aliases. This unblocks Codex
          // turns immediately instead of hanging. Phase 6 will replace
          // these handlers with a UI-driven decision flow:
          //   1. handler returns a Promise tied to a pending-approval
          //      registry keyed by the JSON-RPC request id
          //   2. translateCodexApproval emits canonical
          //      permission_request to the chat stream
          //   3. PermissionPrompt resolves the user's decision back
          //      via the registry → handler returns ReviewDecision
          //
          // Until then, the conservative default keeps the Codex turn
          // moving (declined commands surface as a normal denial in
          // the chat transcript) without leaking permissions.
          const declineByDefault = () => ({ decision: 'decline' as const });
          for (const method of [
            'item/commandExecution/requestApproval',
            'item/fileChange/requestApproval',
            'item/permissions/requestApproval',
            'execCommandApproval', // legacy
            'applyPatchApproval', // legacy
          ]) {
            const unsubReq = client.onServerRequest(method, declineByDefault);
            unsubscribers.push(unsubReq);
          }

          // ── thread resolution: resume if we have a ref, else start ──
          const existingRef = getRuntimeSessionRef(sessionId, 'codex_runtime');
          let threadId: string;
          if (existingRef) {
            try {
              await client.request('thread/resume', { threadId: existingRef.token });
              threadId = existingRef.token;
            } catch {
              // Resume failed (thread archived / unknown id) → start fresh.
              const result = await client.request<{ thread: { id: string } }>(
                'thread/start',
                { cwd: options.workingDirectory },
              );
              threadId = result.thread.id;
              setRuntimeSessionRef(sessionId, { runtimeId: 'codex_runtime', token: threadId });
            }
          } else {
            const result = await client.request<{ thread: { id: string } }>(
              'thread/start',
              { cwd: options.workingDirectory },
            );
            threadId = result.thread.id;
            setRuntimeSessionRef(sessionId, { runtimeId: 'codex_runtime', token: threadId });
          }

          // ── notification fan-out ────────────────────────────────────
          // Phase 5 review round 2 (2026-05-13): subscribe through the
          // wildcard hook so the canonical mapper sees EVERY notification.
          // Previously we registered ~9 specific method handlers — anything
          // outside that allowlist silently dropped, contradicting the
          // mapper's `unknown_item` fallback contract. The wildcard puts
          // every notification through `translateCodexNotification`, so
          // unknown methods actually reach the chat surface as
          // `unknown_item` blocks instead of vanishing.
          const unsubAny = client.onAnyNotification((method, params) => {
            const event = translateCodexNotification(method, params, { sessionId });
            if (event) {
              tryEnqueue(canonicalToSseLine(event));
            }
            // Stream lifecycle close on terminal canonical events.
            // turn/completed with status=failed lands as `run_failed`
            // (per the mapper); status=completed/interrupted/inProgress
            // lands as `run_completed`. Both close the stream.
            if (event?.type === 'run_completed' || event?.type === 'run_failed') {
              // Slice 3 (2026-05-13) — drop the active-turn entry so
              // a future interrupt() against this session doesn't
              // chase a stale turnId.
              activeCodexTurns.delete(sessionId);
              closeStream();
            }
          });
          unsubscribers.push(unsubAny);

          // ── kick off the turn ───────────────────────────────────────
          // Phase 5 Phase 4 Slice 3 — capture the returned turn id so
          // `interrupt(sessionId)` can issue `turn/interrupt` with the
          // correct (threadId, turnId) pair per
          // `TurnInterruptParams = { threadId, turnId }` in the schema.
          const turnResult = await client.request<{ turn: { id: string } }>('turn/start', {
            threadId,
            input: [{ type: 'text', text: options.prompt }],
            ...(options.workingDirectory ? { cwd: options.workingDirectory } : {}),
            ...(options.model ? { model: options.model } : {}),
            ...(options.effort ? { effort: options.effort } : {}),
          });
          activeCodexTurns.set(sessionId, { threadId, turnId: turnResult.turn.id });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          closeStream({ error: reason });
        }
      },
    });
  },

  interrupt(sessionId: string): void {
    // Phase 5 Phase 4 Slice 3 (2026-05-13) — issue a proper
    // `turn/interrupt` with (threadId, turnId). Both ids come from
    // the in-process `activeCodexTurns` map populated when
    // `turn/start` resolves. The map entry clears on turn/completed
    // or turn/failed so a stale entry can't fire after the turn
    // is already done.
    //
    // Best-effort still: if Codex isn't reachable or the entry is
    // missing (race against turn completion), the call no-ops. Per
    // upstream README, `turn/interrupt` resolves to `{}` on success
    // and the turn ultimately finishes with status: 'interrupted'.
    const active = activeCodexTurns.get(sessionId);
    if (!active) {
      console.debug('[codex.runtime] interrupt requested but no active turn for', sessionId);
      return;
    }
    void (async () => {
      try {
        const { client } = await getCodexAppServer();
        await client.request('turn/interrupt', {
          threadId: active.threadId,
          turnId: active.turnId,
        });
      } catch (err) {
        console.debug('[codex.runtime] turn/interrupt failed (best-effort):', err);
      }
    })();
  },

  dispose(): void {
    // Codex app-server lifecycle is managed centrally in
    // `app-server-manager.ts`. The runtime itself holds no
    // per-instance resources. Electron 'before-quit' / dev SIGTERM
    // calls `disposeCodexAppServer()` directly.
  },
};
