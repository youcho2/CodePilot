/**
 * Codex notification → canonical event mapper.
 *
 * Phase 5 Phase 3 (2026-05-13) + review fix round 1 (same day).
 * Maps the wide Codex app-server notification surface into:
 *
 *   - `RuntimeRunEvent` (canonical 9-type union) for chat / Run /
 *     Preview UI consumers.
 *   - `RuntimePermissionEvent` for permission UI consumers.
 *   - `null` for transport-only events (heartbeats / acks / different
 *     channel like account events).
 *
 * Unknown methods fall through to `unknown_item` per the contract.
 *
 * Schema source of truth — every method name in the switch below MUST
 * appear in `资料/codex/codex-rs/app-server-protocol/schema/typescript/ServerNotification.ts`.
 * The `codex-method-names.test.ts` guardrail reads that file at test
 * time and fails the build if any name in this module isn't present.
 *
 * Field shapes are also pinned to schema. Three places where review
 * round 1 caught me hallucinating:
 *
 *   - `ItemStartedNotification.params.item.id` (not `params.itemId`)
 *     and `params.item.command: string` (not `string[]`) per ThreadItem
 *     commandExecution variant.
 *   - `ThreadTokenUsageUpdatedNotification.params.tokenUsage.last.{inputTokens,
 *     outputTokens}` + `params.tokenUsage.modelContextWindow` — a layered
 *     shape, not flat.
 *   - Method names like `account/login/completed` /
 *     `account/rateLimits/updated` / `thread/status/changed` — Codex
 *     uses slash-separated namespaces, not camelCase.
 */

import type {
  RuntimeRunEvent,
  RuntimePermissionEvent,
} from '@/lib/runtime/contract';
import {
  makeAssistantDelta,
  makeToolStarted,
  makeToolCompleted,
  makeCommandStarted,
  makeFileChanged,
  makeUsageUpdated,
  makeRunCompleted,
  makeRunFailed,
  makeUnknownItem,
} from '@/lib/runtime/event-adapter';

interface CodexMappingContext {
  sessionId: string;
}

// ─────────────────────────────────────────────────────────────────────
// Known Codex notification methods. Pinned to upstream ServerNotification
// union; the codex-method-names.test.ts guardrail asserts this set is a
// subset of the schema file at test time.
// ─────────────────────────────────────────────────────────────────────

const KNOWN_CODEX_METHODS = new Set<string>([
  // Run lifecycle
  'thread/started',
  'thread/closed',
  'thread/status/changed',
  'thread/compacted',
  'turn/started',
  'turn/completed',
  'turn/diff/updated',
  'turn/plan/updated',
  // Streaming text / reasoning
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/textDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  // Items lifecycle
  'item/started',
  'item/completed',
  'item/autoApprovalReview/started',
  'item/autoApprovalReview/completed',
  // Token usage
  'thread/tokenUsage/updated',
  // Command / process / fs streams
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'command/exec/outputDelta',
  'process/outputDelta',
  'process/exited',
  'fs/changed',
  // Account
  'account/updated',
  'account/login/completed',
  'account/rateLimits/updated',
  // Hooks / MCP
  'hook/started',
  'hook/completed',
  'item/mcpToolCall/progress',
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
  // Misc
  'app/list/updated',
  'remoteControl/status/changed',
  'externalAgentConfig/import/completed',
  'thread/realtime/started',
  'thread/realtime/itemAdded',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/error',
  'thread/realtime/closed',
  'thread/name/updated',
  'thread/goal/updated',
  'thread/goal/cleared',
  'thread/archived',
  'thread/unarchived',
  'fuzzyFileSearch/sessionUpdated',
  'fuzzyFileSearch/sessionCompleted',
  'model/rerouted',
  'model/verification',
  'rawResponseItem/completed',
  'serverRequest/resolved',
  'skills/changed',
  'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted',
  // Warnings / errors
  'error',
  'warning',
  'guardianWarning',
  'configWarning',
  'deprecationNotice',
]);

/**
 * Translate one Codex notification into a canonical `RuntimeRunEvent`.
 * Returns null when the notification is transport-only OR belongs to
 * a different channel (e.g. account events surface through
 * `/api/codex/account`, not the run-event stream).
 */
export function translateCodexNotification(
  method: string,
  params: unknown,
  ctx: CodexMappingContext,
): RuntimeRunEvent | null {
  const base = { runtimeId: 'codex_runtime' as const, sessionId: ctx.sessionId };

  switch (method) {
    // ─── streaming text ────────────────────────────────────────────
    // AgentMessageDeltaNotification = { threadId, turnId, itemId, delta }
    case 'item/agentMessage/delta': {
      const p = params as { delta?: string };
      if (typeof p.delta !== 'string' || p.delta.length === 0) return null;
      return makeAssistantDelta(base, p.delta);
    }
    // ReasoningTextDeltaNotification + ReasoningSummaryTextDeltaNotification
    // both expose `delta: string` at top level.
    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta': {
      const p = params as { delta?: string };
      if (typeof p.delta !== 'string' || p.delta.length === 0) return null;
      return makeAssistantDelta(base, p.delta);
    }

    // ─── item lifecycle ────────────────────────────────────────────
    // ItemStartedNotification = { item: ThreadItem, threadId, turnId,
    //                             startedAtMs }
    // ThreadItem is a discriminated union; id and type live INSIDE
    // `item`, not at the top level.
    case 'item/started': {
      const p = params as { item?: ThreadItemLike };
      if (!p.item) return null;
      return translateItemStarted(p.item, base);
    }
    // ItemCompletedNotification = { item: ThreadItem, threadId, turnId,
    //                               completedAtMs }
    case 'item/completed': {
      const p = params as { item?: ThreadItemLike };
      if (!p.item) return null;
      return translateItemCompleted(p.item, base);
    }

    // ─── token usage ───────────────────────────────────────────────
    // ThreadTokenUsageUpdatedNotification = { threadId, turnId, tokenUsage }
    // ThreadTokenUsage = { total, last, modelContextWindow }
    // TokenUsageBreakdown = { totalTokens, inputTokens, cachedInputTokens,
    //                          outputTokens, reasoningOutputTokens }
    // We surface the LAST turn's input/output + the model window.
    case 'thread/tokenUsage/updated': {
      const p = params as {
        tokenUsage?: {
          last?: { inputTokens?: number; outputTokens?: number };
          modelContextWindow?: number | null;
        };
      };
      const usage = p.tokenUsage;
      if (!usage) return null;
      return makeUsageUpdated(base, {
        inputTokens: usage.last?.inputTokens,
        outputTokens: usage.last?.outputTokens,
        contextWindow: usage.modelContextWindow ?? undefined,
      });
    }

    // ─── turn lifecycle ────────────────────────────────────────────
    // TurnCompletedNotification = { threadId, turn: Turn }
    // Turn = { id, items, itemsView, status: TurnStatus,
    //         error: TurnError | null, startedAt, completedAt, durationMs }
    // TurnStatus = "completed" | "interrupted" | "failed" | "inProgress"
    // TurnError = { message, codexErrorInfo, additionalDetails }
    //
    // Phase 5 review round 2 fix (2026-05-13) — earlier revision read
    // `params.status` (flat, doesn't exist) → every turn appeared as
    // a successful end_turn, including failed and interrupted ones.
    case 'turn/completed': {
      const p = params as {
        turn?: {
          status?: 'completed' | 'interrupted' | 'failed' | 'inProgress';
          error?: { message?: string; additionalDetails?: string | null } | null;
        };
      };
      const status = p.turn?.status;
      if (status === 'failed') {
        const err = p.turn?.error;
        const message =
          (err?.message && err.message.trim().length > 0 ? err.message : null) ??
          err?.additionalDetails ??
          'Codex turn failed';
        return makeRunFailed(base, { code: 'codex_turn_failed', message });
      }
      // For completed / interrupted / inProgress (and missing status —
      // be conservative): preserve the real status as finishReason so
      // downstream can distinguish user-interrupt from natural end_turn.
      return makeRunCompleted(base, { finishReason: status ?? 'completed' });
    }
    // ErrorNotification — top-level Codex error channel (out-of-band
    // failures not tied to a specific turn).
    case 'error': {
      const p = params as { code?: string | number; message?: string };
      return makeRunFailed(base, {
        code: String(p.code ?? 'codex_error'),
        message: p.message ?? 'Codex error',
      });
    }

    // ─── file changes ──────────────────────────────────────────────
    // FsChangedNotification = { watchId, changedPaths }
    case 'fs/changed': {
      const p = params as { changedPaths?: string[] };
      if (!Array.isArray(p.changedPaths) || p.changedPaths.length === 0) return null;
      return makeFileChanged(base, { paths: p.changedPaths });
    }

    // ─── transport-only / different channel ────────────────────────
    case 'thread/started':
    case 'thread/closed':
    case 'thread/status/changed':
    case 'thread/compacted':
    case 'thread/name/updated':
    case 'thread/goal/updated':
    case 'thread/goal/cleared':
    case 'thread/archived':
    case 'thread/unarchived':
    case 'turn/started':
    case 'turn/diff/updated':
    case 'turn/plan/updated':
    case 'item/plan/delta':
    case 'item/reasoning/summaryPartAdded':
    case 'item/commandExecution/outputDelta':
    case 'item/commandExecution/terminalInteraction':
    case 'item/fileChange/outputDelta':
    case 'item/fileChange/patchUpdated':
    case 'item/autoApprovalReview/started':
    case 'item/autoApprovalReview/completed':
    case 'item/mcpToolCall/progress':
    case 'command/exec/outputDelta':
    case 'process/outputDelta':
    case 'process/exited':
    case 'rawResponseItem/completed':
    case 'serverRequest/resolved':
    case 'skills/changed':
    case 'account/updated':
    case 'account/login/completed':
    case 'account/rateLimits/updated':
    case 'app/list/updated':
    case 'remoteControl/status/changed':
    case 'externalAgentConfig/import/completed':
    case 'hook/started':
    case 'hook/completed':
    case 'mcpServer/oauthLogin/completed':
    case 'mcpServer/startupStatus/updated':
    case 'thread/realtime/started':
    case 'thread/realtime/itemAdded':
    case 'thread/realtime/transcript/delta':
    case 'thread/realtime/transcript/done':
    case 'thread/realtime/outputAudio/delta':
    case 'thread/realtime/sdp':
    case 'thread/realtime/error':
    case 'thread/realtime/closed':
    case 'fuzzyFileSearch/sessionUpdated':
    case 'fuzzyFileSearch/sessionCompleted':
    case 'model/rerouted':
    case 'model/verification':
    case 'warning':
    case 'guardianWarning':
    case 'configWarning':
    case 'deprecationNotice':
    case 'windows/worldWritableWarning':
    case 'windowsSandbox/setupCompleted':
      return null;

    default:
      // Unknown → fallback per contract. Adapter MUST surface, never drop.
      return makeUnknownItem(base, {
        sourceType: `codex.${method}`,
        payload: params,
      });
  }
}

// ─────────────────────────────────────────────────────────────────────
// ThreadItem helpers — minimal shape per upstream schema. We don't
// import the full ThreadItem union from `资料/` to avoid coupling
// production code to the vendored schema directory; this narrow shape
// covers what we read.
// ─────────────────────────────────────────────────────────────────────

interface ThreadItemLike {
  type?: string;
  id?: string;
  // commandExecution
  command?: string; // schema says string, not array
  cwd?: string;
  exitCode?: number | null;
  aggregatedOutput?: string | null;
  // mcpToolCall
  server?: string;
  // mcpToolCall + dynamicToolCall
  tool?: string;
  // dynamicToolCall
  namespace?: string | null;
  // generic tool-call status / args
  status?: string;
  arguments?: unknown;
  // fileChange
  changes?: ReadonlyArray<unknown>;
  // webSearch
  query?: string;
  // agentMessage / plan / reasoning
  text?: string;
}

/**
 * ThreadItem types whose lifecycle (started/completed) is meaningful
 * to the chat / Run / Preview UI as a discrete event. Adapter emits
 * canonical events for these.
 */
const TOOL_LIKE_ITEM_TYPES = new Set<string>([
  'commandExecution',
  'mcpToolCall',
  'dynamicToolCall',
  'fileChange',
  'webSearch',
]);

/**
 * ThreadItem types we know about but that DON'T need a discrete
 * chat-side event from `item/started` / `item/completed`. The text
 * for agentMessage / plan / reasoning already streams through
 * `item/agentMessage/delta` / `item/plan/delta` / `item/reasoning/*`,
 * so emitting a separate canonical event would just noise the
 * transcript. userMessage is what the user sent us (already on screen).
 *
 * Phase 5 review round 2 fix (2026-05-13) — earlier revision dumped
 * these into `unknown_item`, which the runtime then surfaces as a
 * `status` SSE line. `useSSEStream.ts:229` displayed the raw JSON
 * as status text, so a normal Codex reply briefly showed
 * "codex.item/started.agentMessage" then "completed.agentMessage"
 * as chat status. Returning null suppresses that noise; the
 * agentMessage content still arrives via the streaming delta path.
 */
const CHAT_ONLY_ITEM_TYPES = new Set<string>([
  'userMessage',
  'hookPrompt',
  'agentMessage',
  'plan',
  'reasoning',
  'enteredReviewMode',
  'exitedReviewMode',
  'contextCompaction',
  'collabAgentToolCall',
  'imageView',
  'imageGeneration',
]);

function translateItemStarted(
  item: ThreadItemLike,
  base: { runtimeId: 'codex_runtime'; sessionId: string },
): RuntimeRunEvent | null {
  const id = item.id ?? 'unknown';
  if (item.type === 'commandExecution') {
    // ThreadItem.commandExecution.command is a string (not array).
    return makeCommandStarted(base, {
      commandId: id,
      command: item.command ?? '',
      cwd: item.cwd,
    });
  }
  if (item.type === 'mcpToolCall') {
    const name = item.tool
      ? (item.server ? `${item.server}.${item.tool}` : item.tool)
      : 'mcpToolCall';
    return makeToolStarted(base, { toolId: id, name, input: item.arguments });
  }
  if (item.type === 'dynamicToolCall') {
    const name = item.tool
      ? (item.namespace ? `${item.namespace}.${item.tool}` : item.tool)
      : 'dynamicToolCall';
    return makeToolStarted(base, { toolId: id, name, input: item.arguments });
  }
  if (item.type === 'fileChange') {
    return makeToolStarted(base, {
      toolId: id,
      name: 'fileChange',
      input: { changes: item.changes },
    });
  }
  if (item.type === 'webSearch') {
    return makeToolStarted(base, {
      toolId: id,
      name: 'web_search',
      input: { query: item.query },
    });
  }
  // Known chat-only item types — text / reasoning / review markers
  // etc. carry no extra info in the lifecycle event; the actual
  // content streams through dedicated delta methods. Return null
  // instead of polluting the chat status surface.
  if (typeof item.type === 'string' && CHAT_ONLY_ITEM_TYPES.has(item.type)) {
    return null;
  }
  // Truly unknown item type — surface via fallback so we don't drop
  // brand-new Codex item variants silently.
  if (typeof item.type === 'string') {
    return makeUnknownItem(base, {
      sourceType: `codex.item/started.${item.type}`,
      payload: item,
    });
  }
  return null;
}

function translateItemCompleted(
  item: ThreadItemLike,
  base: { runtimeId: 'codex_runtime'; sessionId: string },
): RuntimeRunEvent | null {
  const id = item.id ?? 'unknown';
  // For commandExecution: output is `aggregatedOutput`; error implied
  // by non-zero exitCode.
  if (item.type === 'commandExecution') {
    const errorIfAny =
      typeof item.exitCode === 'number' && item.exitCode !== 0
        ? `exit ${item.exitCode}`
        : undefined;
    return makeToolCompleted(base, {
      toolId: id,
      output: item.aggregatedOutput ?? '',
      error: errorIfAny,
    });
  }
  // For tool-like items — generic output via item shape; runtime
  // adapter doesn't need to differentiate.
  if (item.type && TOOL_LIKE_ITEM_TYPES.has(item.type)) {
    return makeToolCompleted(base, { toolId: id, output: item });
  }
  // Known chat-only types — no completion event for the UI (the
  // content already arrived via the streaming delta path).
  if (typeof item.type === 'string' && CHAT_ONLY_ITEM_TYPES.has(item.type)) {
    return null;
  }
  // Truly unknown item type — fallback so new variants stay visible.
  if (typeof item.type === 'string') {
    return makeUnknownItem(base, {
      sourceType: `codex.item/completed.${item.type}`,
      payload: item,
    });
  }
  return null;
}

/**
 * Translate Codex's server-to-client approval requests into the
 * canonical `permission_request` event. Server-originated requests
 * are handled by `CodexAppServerClient.onServerRequest`; this helper
 * produces the canonical event the UI consumes.
 *
 * Subjects today:
 *   - `item/commandExecution/requestApproval` → `Bash · <command>`
 *   - `item/fileChange/requestApproval`       → `Patch`
 *   - `item/permissions/requestApproval`      → `Permissions`
 *   - Legacy `execCommandApproval`            → `Bash · <command>`
 *   - Legacy `applyPatchApproval`             → `Patch · N files`
 *
 * Future Codex approval kinds fall through to `permission_unavailable`
 * per the conservative-default contract.
 */
export function translateCodexApproval(args: {
  method: string;
  params: unknown;
  sessionId: string;
  requestId: string;
}): RuntimePermissionEvent {
  const { method, params, sessionId, requestId } = args;
  const base = {
    runtimeId: 'codex_runtime' as const,
    sessionId,
    requestId,
  };

  switch (method) {
    // CommandExecutionRequestApprovalParams (current canonical):
    // { threadId, turnId, itemId, startedAtMs, approvalId?, reason?,
    //   command? (string!), cwd?, commandActions? }
    case 'item/commandExecution/requestApproval': {
      const p = params as { command?: string; cwd?: string; reason?: string };
      const detailLines: string[] = [];
      if (p.cwd) detailLines.push(`cwd: ${p.cwd}`);
      if (p.reason) detailLines.push(p.reason);
      return {
        type: 'permission_request',
        ...base,
        toolName: 'Bash',
        toolInput: { command: p.command ?? '', cwd: p.cwd },
        subject: p.command ? `Bash · ${p.command}` : 'Bash',
        details: detailLines.length > 0 ? detailLines.join('\n') : undefined,
        nativeRequestRef: {
          runtimeId: 'codex_runtime',
          raw: { method, params },
        },
      };
    }

    // Legacy ExecCommandApprovalParams (server-side variant):
    // { conversationId, callId, approvalId?, command: string[], cwd, reason?, parsedCmd }
    // command is an array on this legacy path; join for display.
    case 'execCommandApproval': {
      const p = params as { command?: string[]; cwd?: string; reason?: string };
      const cmd = Array.isArray(p.command) ? p.command.join(' ') : '';
      const detailLines: string[] = [];
      if (p.cwd) detailLines.push(`cwd: ${p.cwd}`);
      if (p.reason) detailLines.push(p.reason);
      return {
        type: 'permission_request',
        ...base,
        toolName: 'Bash',
        toolInput: { command: p.command ?? [], cwd: p.cwd },
        subject: cmd ? `Bash · ${cmd}` : 'Bash',
        details: detailLines.length > 0 ? detailLines.join('\n') : undefined,
        nativeRequestRef: {
          runtimeId: 'codex_runtime',
          raw: { method, params },
        },
      };
    }

    // FileChangeRequestApprovalParams (current canonical):
    // { threadId, turnId, itemId, startedAtMs, reason?, grantRoot? }
    // No fileChanges in the canonical shape — the file list lives in
    // the corresponding `item/started` event with the same itemId.
    case 'item/fileChange/requestApproval': {
      const p = params as { reason?: string; itemId?: string };
      return {
        type: 'permission_request',
        ...base,
        toolName: 'Patch',
        toolInput: { itemId: p.itemId },
        subject: 'Patch',
        details: p.reason ?? undefined,
        nativeRequestRef: {
          runtimeId: 'codex_runtime',
          raw: { method, params },
        },
      };
    }

    // Legacy ApplyPatchApprovalParams: has fileChanges map; counter for UI.
    case 'applyPatchApproval': {
      const p = params as { fileChanges?: Record<string, unknown>; reason?: string };
      const files = p.fileChanges ? Object.keys(p.fileChanges) : [];
      const subject = files.length > 0
        ? `Patch · ${files.length} file${files.length === 1 ? '' : 's'}`
        : 'Patch';
      return {
        type: 'permission_request',
        ...base,
        toolName: 'Patch',
        toolInput: { files, fileChanges: p.fileChanges },
        subject,
        details: p.reason ?? undefined,
        nativeRequestRef: {
          runtimeId: 'codex_runtime',
          raw: { method, params },
        },
      };
    }

    case 'item/permissions/requestApproval': {
      const p = params as { reason?: string };
      return {
        type: 'permission_request',
        ...base,
        toolName: 'Permissions',
        subject: 'Codex requests elevated permissions',
        details: p.reason ?? undefined,
        nativeRequestRef: {
          runtimeId: 'codex_runtime',
          raw: { method, params },
        },
      };
    }

    default:
      // Conservative default — unknown approval kind. Adapter must
      // emit unavailable rather than fall through to granted.
      return {
        type: 'permission_unavailable',
        ...base,
        reason: `Codex approval kind not yet mapped: ${method}`,
      };
  }
}

/** Exposed for tests + contract pinning. */
export const CODEX_KNOWN_NOTIFICATION_METHODS = Array.from(KNOWN_CODEX_METHODS);

/**
 * Synthesize a canonical `file_changed` event from a fileChange item
 * payload at item/completed time.
 *
 * Phase 5 review round 3 (2026-05-13) — earlier revision only
 * translated fs/changed notifications into file_changed. But fs/changed
 * only fires when CodePilot has explicitly subscribed via fs/watch,
 * and ThreadItem.fileChange completions already carry the touched
 * paths inside `changes[]` (FileUpdateChange = { path, kind, diff }).
 * Without this synthesizer, Codex applying a patch via fileChange
 * wouldn't trigger preview auto-refresh even though the runtime
 * knows exactly which files changed.
 *
 * The runtime emits BOTH `tool_completed` (so chat shows "fileChange
 * done") AND this `file_changed` event (so PreviewPanel quiet-
 * refreshes). Two events from one item is legitimate — they serve
 * different downstream channels (chat UI vs preview dispatch).
 *
 * Returns null when params don't carry a fileChange item with
 * non-empty changes.
 */
export function synthesizeFileChangedFromCompletedItem(
  params: unknown,
  ctx: CodexMappingContext,
): RuntimeRunEvent | null {
  const p = params as { item?: ThreadItemLike };
  if (!p.item || p.item.type !== 'fileChange') return null;
  const changes = p.item.changes;
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const paths: string[] = [];
  for (const c of changes) {
    if (c && typeof c === 'object' && 'path' in (c as Record<string, unknown>)) {
      const path = (c as { path?: unknown }).path;
      if (typeof path === 'string' && path.length > 0) paths.push(path);
    }
  }
  if (paths.length === 0) return null;
  return makeFileChanged(
    { runtimeId: 'codex_runtime' as const, sessionId: ctx.sessionId },
    { paths },
  );
}
