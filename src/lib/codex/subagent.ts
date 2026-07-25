/** CodePilot-managed, same-Runtime Codex Sub Agent execution. */

import crypto from 'node:crypto';
import { getCodexAppServer } from './app-server-manager';
import { buildCodexThreadParams, resolveCodexProxyBaseUrl } from './provider-proxy';
import { buildCodexTurnInput } from './turn-input';
import type { CodexMcpServersConfig } from './mcp-config';
import {
  resolveCodexPermissionWire,
  type CodexPermissionWire,
} from './permission';
import type { SubagentRoute } from '../subagent-models';
import type { SubagentExecutionStatus, SubagentStatusError } from '../subagent-status';
import type { RecordSubagentRunEventInput } from '@/types';

export const CODEX_SUBAGENT_SESSION_PREFIX = 'codex-subagent-';
export const CODEX_SUBAGENT_TIMEOUT_MS = 5 * 60 * 1000;

export interface CodexSubagentParentContext {
  permission: CodexPermissionWire;
  mcpServers?: CodexMcpServersConfig;
  /**
   * The authoritative parent chat-turn cancellation source. The proxy
   * request signal is only a transport fallback and may outlive a queued
   * parent Stop action.
   */
  abortSignal?: AbortSignal;
}

const CODEX_SUBAGENT_PARENT_CONTEXTS = Symbol.for(
  'codepilot.codex-subagent-parent-contexts',
);

function getParentContexts(): Map<string, CodexSubagentParentContext> {
  const processState = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const existing = processState[CODEX_SUBAGENT_PARENT_CONTEXTS];
  if (existing instanceof Map) {
    return existing as Map<string, CodexSubagentParentContext>;
  }
  const created = new Map<string, CodexSubagentParentContext>();
  processState[CODEX_SUBAGENT_PARENT_CONTEXTS] = created;
  return created;
}

export function registerCodexSubagentParentContext(
  sessionId: string,
  context: CodexSubagentParentContext,
): () => void {
  const parentContexts = getParentContexts();
  parentContexts.set(sessionId, context);
  return () => {
    if (parentContexts.get(sessionId) === context) parentContexts.delete(sessionId);
  };
}

export function getCodexSubagentParentContext(
  sessionId: string,
): CodexSubagentParentContext | undefined {
  return getParentContexts().get(sessionId);
}

export function resolveCodexSubagentPermission(
  parentContext?: CodexSubagentParentContext,
): CodexPermissionWire {
  return parentContext?.permission || resolveCodexPermissionWire({ permissionMode: 'default' });
}

export function resolveCodexSubagentAbortSignal(
  parentContext: CodexSubagentParentContext | undefined,
  transportSignal?: AbortSignal,
): AbortSignal | undefined {
  const parentSignal = parentContext?.abortSignal;
  if (!parentSignal) return transportSignal;
  if (!transportSignal || transportSignal === parentSignal) return parentSignal;
  const nativeAny = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  return nativeAny
    ? nativeAny.call(AbortSignal, [parentSignal, transportSignal])
    : combineCodexSubagentAbortSignalsFallback([parentSignal, transportSignal]);
}

/**
 * Compatibility path for development environments whose Node runtime does
 * not expose AbortSignal.any(). Packaged Electron currently does, but the
 * repository still documents Node 18+ for contributors.
 */
export function combineCodexSubagentAbortSignalsFallback(
  signals: readonly AbortSignal[],
): AbortSignal {
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
    for (const [source, listener] of listeners) {
      source.removeEventListener('abort', listener);
    }
    listeners.clear();
  };

  for (const signal of signals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = () => abortFrom(signal);
    listeners.set(signal, listener);
    signal.addEventListener('abort', listener, { once: true });
  }
  return controller.signal;
}

export interface CodexSubagentOutcome {
  status: Exclude<SubagentExecutionStatus, 'running'>;
  text: string;
  effectiveModel?: string;
  error?: SubagentStatusError;
}

interface CodexTurnErrorLike {
  message?: string;
  additionalDetails?: string | null;
  codexErrorInfo?: unknown;
}

interface CodexTurnLike {
  id?: string;
  status?: string;
  error?: CodexTurnErrorLike | null;
  items?: Array<{ type?: string; text?: string; phase?: string | null }>;
}

/**
 * A shared app-server multiplexes every active CodePilot chat and managed
 * child. Consumers must filter by threadId or a child completion can close a
 * parent stream (and child deltas can be rendered as parent prose).
 */
export function codexNotificationBelongsToThread(params: unknown, threadId: string): boolean {
  if (!params || typeof params !== 'object') return true;
  const notificationThreadId = (params as { threadId?: unknown }).threadId;
  return typeof notificationThreadId !== 'string' || notificationThreadId === threadId;
}

export function isManagedCodexSubagentSession(sessionId: string | undefined): boolean {
  return Boolean(sessionId?.startsWith(CODEX_SUBAGENT_SESSION_PREFIX));
}

export function normalizeCodexSubagentTurn(
  turn: CodexTurnLike,
  streamedText = '',
  fallbackError?: CodexTurnErrorLike,
): CodexSubagentOutcome {
  const rawText = extractFinalAgentText(turn.items) || streamedText.trim();
  const reported = parseCodexSubagentOutcome(rawText);
  const text = reported.text;
  if (turn.status === 'completed') {
    if (reported.status === 'failed') {
      return {
        status: 'failed',
        text: text || 'SUBAGENT_REPORTED_FAILURE: the child reported that it could not complete the task.',
        error: reported.error || classifyReportedTaskFailure(text),
      };
    }
    if (reported.status === 'partial') {
      return {
        status: 'partial',
        text: text || 'SUBAGENT_PARTIAL: the child reported only partial completion.',
        error: reported.error || { code: 'RUNTIME_ERROR', retryable: true },
      };
    }
    if (explicitlyReportsTaskFailure(text)) {
      return {
        status: 'failed',
        text,
        error: classifyReportedTaskFailure(text),
      };
    }
    if (!text) {
      return {
        status: 'failed',
        text: 'SUBAGENT_EMPTY_RESULT: Codex reported completion without an assistant result.',
        error: { code: 'EMPTY_RESULT', retryable: true },
      };
    }
    return { status: 'completed', text };
  }
  if (turn.status === 'interrupted') {
    return {
      status: text ? 'partial' : 'cancelled',
      text: text || 'SUBAGENT_CANCELLED: the Codex Sub Agent was interrupted.',
      ...(text ? { error: { code: 'RUNTIME_ERROR' as const, retryable: true } } : {}),
    };
  }
  if (turn.status === 'inProgress') {
    return {
      status: 'partial',
      text: text || 'SUBAGENT_PARTIAL: Codex returned a non-terminal inProgress result.',
      error: { code: 'RUNTIME_ERROR', retryable: true },
    };
  }

  const errorLike = turn.error || fallbackError;
  const message = formatTurnError(errorLike) || text || 'Codex Sub Agent failed.';
  return {
    status: 'failed',
    text: message,
    error: classifyCodexSubagentError(errorLike, message),
  };
}

export async function runCodexSubagent(input: {
  route: SubagentRoute;
  prompt: string;
  workingDirectory?: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  parentContext?: CodexSubagentParentContext;
  onLifecycleEvent?: (update: {
    event: RecordSubagentRunEventInput;
    partialText?: string;
    effectiveModel?: string;
  }) => void;
}): Promise<CodexSubagentOutcome> {
  const timeoutMs = input.timeoutMs ?? CODEX_SUBAGENT_TIMEOUT_MS;
  const { client } = await getCodexAppServer();
  const childSessionId = `${CODEX_SUBAGENT_SESSION_PREFIX}${crypto.randomUUID()}`;
  const permission = resolveCodexSubagentPermission(input.parentContext);
  const threadParams = {
    ...buildCodexThreadParams({
      providerId: input.route.providerId,
      workingDirectory: input.workingDirectory,
      proxyBaseUrl: resolveCodexProxyBaseUrl(),
      model: input.route.id,
      sessionId: childSessionId,
      mcpServers: input.parentContext?.mcpServers,
    }),
    ephemeral: true,
    ...permission.thread,
    developerInstructions: [
      'You are a one-shot CodePilot Sub Agent running in an isolated Codex Runtime thread.',
      'Complete the assigned task and return one concise, self-contained result with concrete evidence.',
      'Use the tools and sandbox inherited from the parent turn. Request approval whenever the inherited Codex policy requires it.',
      'Never spawn another agent or claim access to tools you do not have.',
      'If the task needs live/external information and no corresponding tool is available, explicitly say you cannot complete it. Never substitute training knowledge or stale local files.',
      'Your final response MUST start with exactly one machine-readable line: __CODEPILOT_SUBAGENT_OUTCOME__{"status":"completed"}, __CODEPILOT_SUBAGENT_OUTCOME__{"status":"partial"}, or __CODEPILOT_SUBAGENT_OUTCOME__{"status":"failed","error":{"code":"CAPABILITY_UNAVAILABLE","retryable":true}}. Choose completed only when the assigned task itself succeeded; finishing your response is not task completion. Put the user-facing result after that line.',
    ].join('\n'),
  };

  const started = await client.request<{
    thread: { id: string };
    model?: string;
  }>('thread/start', threadParams);
  if (
    started.model
    && !codexReportedModelMatchesRoute(started.model, input.route)
  ) {
    const text = `SUBAGENT_ROUTE_MISMATCH: requested ${input.route.providerId}/${input.route.id}, but Codex Runtime reported model "${started.model}". CodePilot stopped this attempt instead of silently accepting a fallback.`;
    input.onLifecycleEvent?.({
      event: {
        type: 'route_warning',
        activity: 'Effective model did not match the requested route',
        payload: {
          requestedProviderId: input.route.providerId,
          requestedModel: input.route.id,
          reportedModel: started.model,
        },
      },
      effectiveModel: started.model,
    });
    return {
      status: 'failed',
      text,
      effectiveModel: started.model,
      error: { code: 'ROUTE_MISMATCH', retryable: false },
    };
  }
  const threadId = started.thread.id;
  input.onLifecycleEvent?.({
    event: {
      type: 'activity',
      activity: 'Codex child thread initialized',
      payload: { threadId },
      coalesceKey: 'runtime-init',
    },
    effectiveModel: started.model,
  });
  let turnId = '';
  let streamedText = '';
  let lastError: CodexTurnErrorLike | undefined;
  let lastPartialCheckpointAt = 0;

  return new Promise<CodexSubagentOutcome>((resolve) => {
    let settled = false;
    const cleanup: Array<() => void> = [];
    const finish = (outcome: CodexSubagentOutcome) => {
      if (settled) return;
      settled = true;
      for (const unsubscribe of cleanup.splice(0)) unsubscribe();
      resolve({ ...outcome, ...(started.model ? { effectiveModel: started.model } : {}) });
    };
    const emitPartial = (force = false) => {
      const now = Date.now();
      if (!streamedText.trim() || (!force && now - lastPartialCheckpointAt < 250)) return;
      lastPartialCheckpointAt = now;
      input.onLifecycleEvent?.({
        event: {
          type: 'partial_result',
          activity: 'Generating Sub-agent result',
          payload: { chars: streamedText.length },
          coalesceKey: 'partial-result',
        },
        partialText: streamedText,
        effectiveModel: started.model,
      });
    };
    const interrupt = () => {
      if (!turnId) return;
      void client.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
    };

    cleanup.push(client.onAnyNotification((method, params) => {
      if (!codexNotificationBelongsToThread(params, threadId)) return;
      const payload = params as {
        delta?: unknown;
        turnId?: unknown;
        turn?: CodexTurnLike;
        item?: { type?: unknown; name?: unknown; tool?: unknown };
        error?: CodexTurnErrorLike | null;
        willRetry?: boolean;
      };
      if (typeof payload.turnId === 'string' && turnId && payload.turnId !== turnId) return;
      if (method === 'item/agentMessage/delta' && typeof payload.delta === 'string') {
        streamedText += payload.delta;
        emitPartial();
      } else if (method === 'item/started' && payload.item) {
        const toolName = codexLifecycleToolName(payload.item);
        input.onLifecycleEvent?.({
          event: {
            type: toolName ? 'tool_started' : 'activity',
            activity: toolName ? `Running ${toolName}` : 'Codex child item started',
            ...(toolName ? { toolName } : {}),
          },
          effectiveModel: started.model,
        });
      } else if (method === 'item/completed' && payload.item) {
        const toolName = codexLifecycleToolName(payload.item);
        input.onLifecycleEvent?.({
          event: {
            type: toolName ? 'tool_completed' : 'activity',
            activity: toolName ? `${toolName} completed` : 'Codex child item completed',
            ...(toolName ? { toolName } : {}),
          },
          effectiveModel: started.model,
        });
      } else if (method === 'item/permissions/requestApproval') {
        input.onLifecycleEvent?.({
          event: {
            type: 'permission_requested',
            activity: 'Waiting for Codex permission approval',
          },
          effectiveModel: started.model,
        });
      } else if (method === 'error' && payload.willRetry !== true && payload.error) {
        lastError = payload.error;
      } else if (method === 'turn/completed' && payload.turn) {
        if (turnId && payload.turn.id && payload.turn.id !== turnId) return;
        emitPartial(true);
        finish(normalizeCodexSubagentTurn(payload.turn, streamedText, lastError));
      }
    }));

    const timeout = setTimeout(() => {
      interrupt();
      finish({
        status: 'timed_out',
        text: `SUBAGENT_TIMED_OUT: ${input.route.displayName} did not finish within ${Math.round(timeoutMs / 1000)} seconds.`,
        error: { code: 'TIMEOUT', retryable: true },
      });
    }, timeoutMs);
    cleanup.push(() => clearTimeout(timeout));

    if (input.abortSignal) {
      const onAbort = () => {
        interrupt();
        finish({
          status: 'cancelled',
          text: 'SUBAGENT_CANCELLED: the parent Codex turn was cancelled.',
        });
      };
      if (input.abortSignal.aborted) onAbort();
      else {
        input.abortSignal.addEventListener('abort', onAbort, { once: true });
        cleanup.push(() => input.abortSignal?.removeEventListener('abort', onAbort));
      }
    }
    if (settled) return;

    void client.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: buildCodexTurnInput(input.prompt),
      ...(input.workingDirectory ? { cwd: input.workingDirectory } : {}),
      model: input.route.id,
      ...permission.turn,
    }).then((result) => {
      turnId = result.turn.id;
      if (input.abortSignal?.aborted) interrupt();
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      finish({
        status: 'failed',
        text: message,
        error: classifyCodexSubagentError(undefined, message),
      });
    });
  });
}

export function codexReportedModelMatchesRoute(reportedModel: string, route: SubagentRoute): boolean {
  const reported = reportedModel.trim();
  return new Set([
    route.id,
    route.upstreamId,
    route.displayName,
  ].filter((value): value is string => Boolean(value))).has(reported);
}

function codexLifecycleToolName(
  item: { type?: unknown; name?: unknown; tool?: unknown },
): string | undefined {
  if (typeof item.name === 'string' && item.name.trim()) return item.name.trim();
  if (typeof item.tool === 'string' && item.tool.trim()) return item.tool.trim();
  const type = typeof item.type === 'string' ? item.type : '';
  return /tool|command|mcp/i.test(type) ? type : undefined;
}

function extractFinalAgentText(items: CodexTurnLike['items']): string {
  if (!Array.isArray(items)) return '';
  const messages = items.filter(item =>
    item?.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim(),
  );
  const final = [...messages].reverse().find(item => item.phase === 'final_answer')
    || messages[messages.length - 1];
  return final?.text?.trim() || '';
}

const CODEX_SUBAGENT_OUTCOME_PREFIX = '__CODEPILOT_SUBAGENT_OUTCOME__';

interface CodexReportedSubagentOutcome {
  status?: 'completed' | 'partial' | 'failed';
  text: string;
  error?: SubagentStatusError;
}

function parseCodexSubagentOutcome(text: string): CodexReportedSubagentOutcome {
  const trimmed = text.trim();
  const markerIndex = trimmed.indexOf(CODEX_SUBAGENT_OUTCOME_PREFIX);
  if (markerIndex === -1) return { text: trimmed };
  const jsonStart = markerIndex + CODEX_SUBAGENT_OUTCOME_PREFIX.length;
  const jsonEnd = findJsonObjectEnd(trimmed, jsonStart);
  if (jsonEnd === -1) return { text: trimmed };
  const raw = trimmed.slice(jsonStart, jsonEnd);
  // Some compatible models prepend a sentence before the required marker.
  // Preserve that user-facing evidence while removing only the machine
  // marker, rather than silently treating the whole failed run as completed.
  const body = [
    trimmed.slice(0, markerIndex).trim(),
    trimmed.slice(jsonEnd).trim(),
  ].filter(Boolean).join('\n').trim();
  try {
    const parsed = JSON.parse(raw) as {
      status?: unknown;
      error?: { code?: unknown; retryable?: unknown };
    };
    if (
      parsed.status !== 'completed'
      && parsed.status !== 'partial'
      && parsed.status !== 'failed'
    ) {
      return { text: trimmed };
    }
    const error = parseReportedStatusError(parsed.error);
    return {
      status: parsed.status,
      text: body,
      ...(error ? { error } : {}),
    };
  } catch {
    return { text: trimmed };
  }
}

function findJsonObjectEnd(text: string, start: number): number {
  if (text[start] !== '{') return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function parseReportedStatusError(
  error: { code?: unknown; retryable?: unknown } | undefined,
): SubagentStatusError | undefined {
  if (!error) return undefined;
  const code = error.code;
  if (
    code !== 'AUTH_FORBIDDEN'
    && code !== 'ENTITLEMENT'
    && code !== 'RATE_LIMITED'
    && code !== 'MODEL_UNAVAILABLE'
    && code !== 'ROUTE_MISMATCH'
    && code !== 'CAPABILITY_UNAVAILABLE'
    && code !== 'CONCURRENCY_LIMIT'
    && code !== 'TIMEOUT'
    && code !== 'MAX_TURNS'
    && code !== 'MAX_BUDGET'
    && code !== 'RUNTIME_ERROR'
    && code !== 'EMPTY_RESULT'
  ) {
    return undefined;
  }
  return {
    code,
    ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
  };
}

function explicitlyReportsTaskFailure(text: string): boolean {
  return /(?:^|\n)\s*(?:\*{0,2}(?:无法完成(?:此|该|这个)?任务|不能完成(?:此|该|这个)?任务|任务无法完成|unable to complete (?:this|the) task|cannot complete (?:this|the) task|could not complete (?:this|the) task)\*{0,2})(?:\s|[:：]|$)/im.test(text)
    || /\bSUBAGENT_(?:CAPABILITY_UNAVAILABLE|CANNOT_COMPLETE)\b/i.test(text);
}

function classifyReportedTaskFailure(text: string): SubagentStatusError {
  if (
    /(?:network|联网|网络|DNS|tool|工具|browser|浏览器|capabilit|权限|sandbox|沙箱)[\s\S]{0,120}(?:unavailable|不可用|受限|阻断|无法|missing|没有)/i.test(text)
    || /(?:unavailable|不可用|受限|阻断|无法|missing|没有)[\s\S]{0,120}(?:network|联网|网络|DNS|tool|工具|browser|浏览器|capabilit|权限|sandbox|沙箱)/i.test(text)
  ) {
    return { code: 'CAPABILITY_UNAVAILABLE', retryable: true };
  }
  return { code: 'RUNTIME_ERROR', retryable: true };
}

function formatTurnError(error: CodexTurnErrorLike | null | undefined): string {
  if (!error) return '';
  const parts = [error.message?.trim(), error.additionalDetails?.trim()].filter(Boolean);
  return [...new Set(parts)].join('\n');
}

function classifyCodexSubagentError(
  error: CodexTurnErrorLike | null | undefined,
  fallbackMessage: string,
): SubagentStatusError {
  const httpStatus = findHttpStatus(error?.codexErrorInfo) ?? findStatusInText(fallbackMessage);
  if (httpStatus === 401 || httpStatus === 403) {
    return { code: 'AUTH_FORBIDDEN', httpStatus, retryable: false };
  }
  if (httpStatus === 429) {
    return { code: 'RATE_LIMITED', httpStatus, retryable: true };
  }
  if (/model[^\n]*(?:not found|unavailable|unsupported|not available)|unknown model/i.test(fallbackMessage)) {
    return { code: 'MODEL_UNAVAILABLE', ...(httpStatus ? { httpStatus } : {}), retryable: false };
  }
  return {
    code: 'RUNTIME_ERROR',
    ...(httpStatus ? { httpStatus } : {}),
    retryable: typeof httpStatus === 'number' && httpStatus >= 500,
  };
}

function findHttpStatus(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/httpStatus(?:Code)?/i.test(key) && typeof child === 'number') return child;
    const nested = findHttpStatus(child);
    if (nested) return nested;
  }
  return undefined;
}

function findStatusInText(message: string): number | undefined {
  const match = message.match(/(?:HTTP|API Error|status(?: code)?)\D{0,8}(401|403|429|5\d\d)\b/i);
  return match ? Number(match[1]) : undefined;
}
