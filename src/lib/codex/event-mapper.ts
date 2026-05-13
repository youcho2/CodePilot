/**
 * Codex notification → canonical event mapper.
 *
 * Phase 5 Phase 3 (2026-05-13). Maps the wide Codex app-server
 * notification surface into:
 *
 *   - `RuntimeRunEvent` (canonical 9-type union) for chat / Run /
 *     Preview UI consumers.
 *   - `RuntimePermissionEvent` for permission UI consumers.
 *   - `null` for transport-only events (heartbeats / acks).
 *
 * Unknown methods fall through to `unknown_item` per the contract.
 *
 * The mapping is intentionally selective today — Codex emits 50+
 * notification types; we wire the ones that drive immediate UI
 * (assistant deltas, turn lifecycle, command + tool events, file
 * changes, token usage, login). Other notifications surface as
 * `unknown_item` so they're never silently dropped — Phase 6 expands
 * coverage as user-visible features land.
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
// Notification table — known method → canonical translator OR null
// (transport-only). Anything not in the table falls back to
// `unknown_item` per the contract guardrail.
// ─────────────────────────────────────────────────────────────────────

const KNOWN_CODEX_METHODS = new Set<string>([
  // Run lifecycle
  'thread/started',
  'thread/closed',
  'thread/statusChanged',
  'turn/started',
  'turn/completed',
  'turn/failed',
  // Streaming text / reasoning
  'item/agentMessage/delta',
  'item/reasoningText/delta',
  'item/reasoningSummaryText/delta',
  'item/reasoningSummaryPart/added',
  // Items lifecycle
  'item/started',
  'item/completed',
  // Token usage
  'thread/tokenUsage/updated',
  // Command / process / fs streams
  'item/commandExecution/outputDelta',
  'process/outputDelta',
  'process/exited',
  'fs/changed',
  // Account
  'account/updated',
  'account/loginCompleted',
  'account/rateLimitsUpdated',
  // Transport-only / informational
  'keep_alive',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/realtime/output/audio/delta',
  // Errors / warnings
  'error',
  'guardian/warning',
  'config/warning',
  'deprecation/notice',
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
    case 'item/agentMessage/delta': {
      const p = params as { delta?: string };
      if (typeof p.delta !== 'string' || p.delta.length === 0) return null;
      return makeAssistantDelta(base, p.delta);
    }
    case 'item/reasoningText/delta':
    case 'item/reasoningSummaryText/delta': {
      // Reasoning surfaces as assistant_delta too — the chat side
      // doesn't distinguish today (Phase 4 / overhaul lumped thinking
      // into assistant_delta). Future enhancement: dedicated channel.
      const p = params as { delta?: string };
      if (typeof p.delta !== 'string' || p.delta.length === 0) return null;
      return makeAssistantDelta(base, p.delta);
    }

    // ─── tool / command lifecycle ──────────────────────────────────
    case 'item/started': {
      const p = params as {
        itemId?: string;
        item?: { type?: string; name?: string; command?: string[]; cwd?: string };
      };
      if (!p.item) return null;
      const itemType = p.item.type ?? 'unknown';
      // Command exec → command_started; everything else with a type
      // surfaces as tool_started so the UI can render it.
      if (
        itemType === 'commandExecution' ||
        itemType === 'localShellExec' ||
        itemType === 'execCommand'
      ) {
        return makeCommandStarted(base, {
          commandId: p.itemId ?? 'unknown',
          command: (p.item.command ?? []).join(' '),
          cwd: p.item.cwd,
        });
      }
      return makeToolStarted(base, {
        toolId: p.itemId ?? 'unknown',
        name: p.item.name ?? itemType,
      });
    }
    case 'item/completed': {
      const p = params as {
        itemId?: string;
        item?: { output?: unknown; error?: string };
      };
      return makeToolCompleted(base, {
        toolId: p.itemId ?? 'unknown',
        output: p.item?.output,
        error: p.item?.error,
      });
    }

    // ─── token usage ───────────────────────────────────────────────
    case 'thread/tokenUsage/updated': {
      const p = params as {
        inputTokens?: number;
        outputTokens?: number;
        modelContextWindow?: number;
      };
      return makeUsageUpdated(base, {
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        contextWindow: p.modelContextWindow,
      });
    }

    // ─── turn lifecycle ────────────────────────────────────────────
    case 'turn/completed': {
      const p = params as { status?: string };
      return makeRunCompleted(base, { finishReason: p.status });
    }
    case 'turn/failed': {
      const p = params as { code?: string; message?: string };
      return makeRunFailed(base, {
        code: p.code ?? 'codex_turn_failed',
        message: p.message ?? 'Codex turn failed',
      });
    }
    case 'error': {
      const p = params as { code?: string | number; message?: string };
      return makeRunFailed(base, {
        code: String(p.code ?? 'codex_error'),
        message: p.message ?? 'Codex error',
      });
    }

    // ─── file changes ──────────────────────────────────────────────
    case 'fs/changed': {
      const p = params as { changedPaths?: string[] };
      if (!Array.isArray(p.changedPaths) || p.changedPaths.length === 0) return null;
      return makeFileChanged(base, { paths: p.changedPaths });
    }

    // ─── transport-only / different channel ────────────────────────
    case 'keep_alive':
    case 'thread/started':
    case 'thread/closed':
    case 'thread/statusChanged':
    case 'turn/started':
    case 'item/reasoningSummaryPart/added':
    case 'item/commandExecution/outputDelta':
    case 'process/outputDelta':
    case 'process/exited':
    case 'account/updated':
    case 'account/loginCompleted':
    case 'account/rateLimitsUpdated':
    case 'thread/realtime/transcript/delta':
    case 'thread/realtime/transcript/done':
    case 'thread/realtime/output/audio/delta':
    case 'guardian/warning':
    case 'config/warning':
    case 'deprecation/notice':
      return null;

    default:
      // Unknown → fallback per contract. Adapter MUST surface, never drop.
      return makeUnknownItem(base, {
        sourceType: `codex.${method}`,
        payload: params,
      });
  }
}

/**
 * Translate Codex's server-to-client approval requests into the
 * canonical `permission_request` event. Server-originated requests
 * are handled separately from notifications in the JSON-RPC client;
 * this helper produces the canonical event the UI consumes.
 *
 * Subjects today:
 *   - `execCommandApproval` → `Bash · <command>`
 *   - `applyPatchApproval`  → `Patch · <fileCount> files`
 *   - `item/commandExecution/requestApproval` / `item/fileChange/...` etc.
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
    case 'execCommandApproval':
    case 'item/commandExecution/requestApproval': {
      const p = params as { command?: string[]; cwd?: string; reason?: string };
      const cmd = (p.command ?? []).join(' ');
      const detailLines: string[] = [];
      if (p.cwd) detailLines.push(`cwd: ${p.cwd}`);
      if (p.reason) detailLines.push(p.reason);
      return {
        type: 'permission_request',
        ...base,
        toolName: 'Bash',
        toolInput: { command: p.command, cwd: p.cwd },
        subject: cmd ? `Bash · ${cmd}` : 'Bash',
        details: detailLines.length > 0 ? detailLines.join('\n') : undefined,
        nativeRequestRef: {
          runtimeId: 'codex_runtime',
          raw: { method, params },
        },
      };
    }

    case 'applyPatchApproval':
    case 'item/fileChange/requestApproval': {
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
