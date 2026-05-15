/**
 * Phase 5 Phase 3 — Codex notification → canonical event mapping.
 *
 * Phase 5 review round 1 (2026-05-13) — payloads in this file are
 * SCHEMA-CORRECT per `资料/codex/codex-rs/app-server-protocol/schema/typescript/`.
 * Earlier revision invented payload shapes (params.itemId,
 * params.command as string[], flat token usage) — that's what Codex
 * caught.
 *
 * Pins:
 *
 *   - assistant deltas + reasoning deltas (item/reasoning/textDelta,
 *     item/reasoning/summaryTextDelta) → `assistant_delta`
 *   - ItemStartedNotification = { item: ThreadItem, … } where the
 *     id / type / command (string!) live inside `item`. commandExecution
 *     → `command_started`; mcpToolCall / dynamicToolCall / fileChange /
 *     webSearch → `tool_started`.
 *   - ItemCompletedNotification mirrors ItemStarted; commandExecution
 *     reads `aggregatedOutput` + `exitCode`.
 *   - thread/tokenUsage/updated → params.tokenUsage.last.{inputTokens,
 *     outputTokens} + params.tokenUsage.modelContextWindow.
 *   - turn/completed → run_completed; top-level `error` notification
 *     → run_failed (Codex doesn't have a separate turn/failed).
 *   - fs/changed → file_changed.
 *   - account/login/completed (slash-namespaced) etc. → null
 *     (transport-only / different channel).
 *   - Unknown method → `unknown_item` with `codex.<method>` sourceType.
 *
 * Approval translator covers both the canonical
 * `item/commandExecution/requestApproval` (command as string) and the
 * legacy `execCommandApproval` (command as string[]).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  translateCodexNotification,
  translateCodexApproval,
  CODEX_KNOWN_NOTIFICATION_METHODS,
} from '@/lib/codex/event-mapper';

const ctx = { sessionId: 's1' };

describe('translateCodexNotification — streaming text', () => {
  it('item/agentMessage/delta → assistant_delta with the text', () => {
    const event = translateCodexNotification(
      'item/agentMessage/delta',
      { threadId: 't', turnId: 'u', itemId: 'i', delta: 'hello' },
      ctx,
    );
    assert.equal(event?.type, 'assistant_delta');
    if (event?.type !== 'assistant_delta') throw new Error('unreachable');
    assert.equal(event.text, 'hello');
    assert.equal(event.runtimeId, 'codex_runtime');
    assert.equal(event.sessionId, 's1');
  });

  it('empty delta returns null (no zero-length text events)', () => {
    const event = translateCodexNotification('item/agentMessage/delta', { delta: '' }, ctx);
    assert.equal(event, null);
  });

  it('item/reasoning/textDelta maps to assistant_delta (slash-namespaced per schema)', () => {
    const event = translateCodexNotification(
      'item/reasoning/textDelta',
      { delta: 'thinking…' },
      ctx,
    );
    assert.equal(event?.type, 'assistant_delta');
  });

  it('item/reasoning/summaryTextDelta also maps to assistant_delta', () => {
    const event = translateCodexNotification(
      'item/reasoning/summaryTextDelta',
      { delta: 'summary' },
      ctx,
    );
    assert.equal(event?.type, 'assistant_delta');
  });
});

describe('translateCodexNotification — item lifecycle (schema-correct)', () => {
  it('item/started commandExecution → command_started (item.id + item.command string)', () => {
    // Per ThreadItem.commandExecution: { type, id, command: string, cwd, ... }
    const event = translateCodexNotification(
      'item/started',
      {
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'ls -la /tmp',
          cwd: '/tmp',
          processId: null,
          source: 'agent',
          status: 'in_progress',
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
        threadId: 't',
        turnId: 'u',
        startedAtMs: 1700000000000,
      },
      ctx,
    );
    assert.equal(event?.type, 'command_started');
    if (event?.type !== 'command_started') throw new Error('unreachable');
    assert.equal(event.commandId, 'cmd-1');
    assert.equal(event.command, 'ls -la /tmp');
    assert.equal(event.cwd, '/tmp');
  });

  it('item/started mcpToolCall → tool_started with server.tool name', () => {
    const event = translateCodexNotification(
      'item/started',
      {
        item: {
          type: 'mcpToolCall',
          id: 'mcp-1',
          server: 'memory',
          tool: 'read_graph',
          status: 'in_progress',
          arguments: { foo: 1 },
        },
        threadId: 't',
        turnId: 'u',
        startedAtMs: 1700000000000,
      },
      ctx,
    );
    assert.equal(event?.type, 'tool_started');
    if (event?.type !== 'tool_started') throw new Error('unreachable');
    assert.equal(event.toolId, 'mcp-1');
    assert.equal(event.name, 'memory.read_graph');
    assert.deepEqual(event.input, { foo: 1 });
  });

  it('item/started dynamicToolCall (with namespace) → tool_started with namespace.tool name', () => {
    const event = translateCodexNotification(
      'item/started',
      {
        item: {
          type: 'dynamicToolCall',
          id: 'dyn-1',
          namespace: 'codepilot',
          tool: 'open_preview',
          arguments: { path: '/tmp/x.md' },
          status: 'in_progress',
        },
        threadId: 't',
        turnId: 'u',
        startedAtMs: 1700000000000,
      },
      ctx,
    );
    if (event?.type !== 'tool_started') throw new Error('unreachable');
    assert.equal(event.name, 'codepilot.open_preview');
  });

  it('item/started fileChange / webSearch → tool_started', () => {
    const file = translateCodexNotification(
      'item/started',
      { item: { type: 'fileChange', id: 'fc-1', changes: [] } },
      ctx,
    );
    if (file?.type !== 'tool_started') throw new Error('unreachable');
    assert.equal(file.name, 'fileChange');

    const search = translateCodexNotification(
      'item/started',
      { item: { type: 'webSearch', id: 'ws-1', query: 'codex' } },
      ctx,
    );
    if (search?.type !== 'tool_started') throw new Error('unreachable');
    assert.equal(search.name, 'web_search');
  });

  it('item/completed commandExecution → tool_completed with aggregatedOutput + exit error', () => {
    const ok = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'true',
          cwd: '/tmp',
          processId: null,
          source: 'agent',
          status: 'success',
          commandActions: [],
          aggregatedOutput: 'OK',
          exitCode: 0,
          durationMs: 12,
        },
      },
      ctx,
    );
    if (ok?.type !== 'tool_completed') throw new Error('unreachable');
    assert.equal(ok.output, 'OK');
    assert.equal(ok.error, undefined);

    const fail = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'commandExecution',
          id: 'cmd-2',
          command: 'false',
          cwd: '/tmp',
          processId: null,
          source: 'agent',
          status: 'failed',
          commandActions: [],
          aggregatedOutput: 'segfault',
          exitCode: 139,
          durationMs: 7,
        },
      },
      ctx,
    );
    if (fail?.type !== 'tool_completed') throw new Error('unreachable');
    assert.equal(fail.error, 'exit 139');
  });

  it('item/started with unknown type → unknown_item fallback (never dropped)', () => {
    const event = translateCodexNotification(
      'item/started',
      { item: { type: 'futureCodexExtensionItem', id: 'x-1' } },
      ctx,
    );
    assert.equal(event?.type, 'unknown_item');
  });
});

describe('translateCodexNotification — turn lifecycle (nested status per schema)', () => {
  // TurnCompletedNotification = { threadId, turn: Turn }
  // Turn.status = 'completed' | 'interrupted' | 'failed' | 'inProgress'
  function turnCompleted(status: string, error?: { message: string }) {
    return {
      threadId: 't',
      turn: {
        id: 'u',
        items: [],
        itemsView: 'all',
        status,
        error: error ?? null,
        startedAt: 0,
        completedAt: 0,
        durationMs: 0,
      },
    };
  }

  it('turn/completed with status=completed → run_completed (preserves real finishReason)', () => {
    const event = translateCodexNotification('turn/completed', turnCompleted('completed'), ctx);
    if (event?.type !== 'run_completed') throw new Error('unreachable');
    assert.equal(event.finishReason, 'completed');
  });

  it('turn/completed with status=interrupted → run_completed with interrupted finishReason', () => {
    // User-interrupted turns must surface as interrupted, NOT as
    // successful end_turn — review round 2 fix (2026-05-13).
    const event = translateCodexNotification('turn/completed', turnCompleted('interrupted'), ctx);
    if (event?.type !== 'run_completed') throw new Error('unreachable');
    assert.equal(event.finishReason, 'interrupted');
  });

  it('turn/completed with status=failed → run_failed (NOT run_completed)', () => {
    // Earlier revision swallowed turn failures as successful end_turn.
    const event = translateCodexNotification(
      'turn/completed',
      turnCompleted('failed', { message: 'context exhausted' }),
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.equal(event.code, 'codex_turn_failed');
    assert.equal(event.message, 'context exhausted');
  });

  it('turn/completed with status=failed and missing error.message → falls back to default text', () => {
    const event = translateCodexNotification(
      'turn/completed',
      turnCompleted('failed', { message: '' }),
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.match(event.message, /Codex turn failed/);
  });

  it('turn/completed with status=inProgress → run_completed (conservative, with the real status as reason)', () => {
    // Codex doesn't typically emit inProgress here, but the schema
    // allows it. Surface the real status so downstream can distinguish.
    const event = translateCodexNotification('turn/completed', turnCompleted('inProgress'), ctx);
    if (event?.type !== 'run_completed') throw new Error('unreachable');
    assert.equal(event.finishReason, 'inProgress');
  });

  it('error notification → run_failed with full TurnError surface (Phase 5b smoke fix 2026-05-15)', () => {
    // Pre-5b the mapper read `params.code` / `params.message` at the
    // top level, which never matched Codex's actual ErrorNotification
    // schema `{ error: TurnError, willRetry, threadId, turnId }`. After
    // the fix the mapper reads `params.error.message` + appends
    // additionalDetails + the codexErrorInfo classification so chat
    // surface stops showing the bare string "Codex error".
    const event = translateCodexNotification(
      'error',
      {
        error: {
          message: 'upstream timed out',
          codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 504 } },
          additionalDetails: 'retry budget exhausted',
        },
        willRetry: false,
        threadId: 't1',
        turnId: 'u1',
      },
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.match(event.message, /upstream timed out/);
    assert.match(event.message, /retry budget exhausted/);
    assert.match(event.message, /httpConnectionFailed HTTP 504/);
    assert.equal(event.code, 'codex:httpConnectionFailed');
  });

  it('error notification with willRetry=true surfaces the retry hint', () => {
    const event = translateCodexNotification(
      'error',
      {
        error: {
          message: 'transient 503',
          codexErrorInfo: 'serverOverloaded',
          additionalDetails: null,
        },
        willRetry: true,
        threadId: 't1',
        turnId: 'u1',
      },
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.match(event.message, /transient 503/);
    assert.match(event.message, /serverOverloaded/);
    assert.match(event.message, /will retry/);
    assert.equal(event.code, 'serverOverloaded');
  });

  it('error notification with empty error.message falls back to "Codex error (no message)"', () => {
    const event = translateCodexNotification(
      'error',
      { error: { message: '', codexErrorInfo: null, additionalDetails: null } },
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.match(event.message, /Codex error \(no message\)/);
    assert.equal(event.code, 'codex_error');
  });
});

describe('translateCodexNotification — chat-only item types return null (P2.1 fix)', () => {
  // Phase 5 review round 2 fix (2026-05-13) — agentMessage / userMessage
  // / plan / reasoning lifecycle previously fell through to unknown_item,
  // which the runtime surfaces as a `status` SSE → useSSEStream renders
  // raw JSON as chat status. That's noise; the actual content streams
  // through dedicated delta methods.
  const chatOnly = [
    'agentMessage',
    'userMessage',
    'plan',
    'reasoning',
    'hookPrompt',
    'enteredReviewMode',
    'exitedReviewMode',
    'contextCompaction',
    'collabAgentToolCall',
    'imageView',
    'imageGeneration',
  ];

  for (const type of chatOnly) {
    it(`item/started type=${type} → null (no chat noise)`, () => {
      const event = translateCodexNotification(
        'item/started',
        { item: { type, id: 'x-1' }, threadId: 't', turnId: 'u', startedAtMs: 0 },
        ctx,
      );
      assert.equal(event, null);
    });
    it(`item/completed type=${type} → null`, () => {
      const event = translateCodexNotification(
        'item/completed',
        { item: { type, id: 'x-1' }, threadId: 't', turnId: 'u', completedAtMs: 0 },
        ctx,
      );
      assert.equal(event, null);
    });
  }
});

describe('translateCodexNotification — token usage (layered shape)', () => {
  it('reads params.tokenUsage.last.{inputTokens,outputTokens} + params.tokenUsage.modelContextWindow', () => {
    const event = translateCodexNotification(
      'thread/tokenUsage/updated',
      {
        threadId: 't',
        turnId: 'u',
        tokenUsage: {
          total: {
            totalTokens: 500,
            inputTokens: 300,
            cachedInputTokens: 100,
            outputTokens: 200,
            reasoningOutputTokens: 50,
          },
          last: {
            totalTokens: 150,
            inputTokens: 100,
            cachedInputTokens: 20,
            outputTokens: 50,
            reasoningOutputTokens: 10,
          },
          modelContextWindow: 200_000,
        },
      },
      ctx,
    );
    assert.equal(event?.type, 'usage_updated');
    if (event?.type !== 'usage_updated') throw new Error('unreachable');
    assert.equal(event.inputTokens, 100);
    assert.equal(event.outputTokens, 50);
    assert.equal(event.contextWindow, 200_000);
  });

  it('handles null modelContextWindow → undefined (don\'t falsely advertise capacity)', () => {
    const event = translateCodexNotification(
      'thread/tokenUsage/updated',
      {
        tokenUsage: {
          total: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
          last: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
          modelContextWindow: null,
        },
      },
      ctx,
    );
    if (event?.type !== 'usage_updated') throw new Error('unreachable');
    assert.equal(event.contextWindow, undefined);
  });

  it('missing tokenUsage → null (no event)', () => {
    const event = translateCodexNotification(
      'thread/tokenUsage/updated',
      { threadId: 't', turnId: 'u' },
      ctx,
    );
    assert.equal(event, null);
  });
});

describe('translateCodexNotification — fs changes', () => {
  it('fs/changed → file_changed with paths array', () => {
    const event = translateCodexNotification(
      'fs/changed',
      { watchId: 'w1', changedPaths: ['/tmp/a.md', '/tmp/b.md'] },
      ctx,
    );
    if (event?.type !== 'file_changed') throw new Error('unreachable');
    assert.deepEqual([...event.paths], ['/tmp/a.md', '/tmp/b.md']);
  });

  it('fs/changed with empty paths → null', () => {
    const event = translateCodexNotification('fs/changed', { changedPaths: [] }, ctx);
    assert.equal(event, null);
  });
});

describe('translateCodexNotification — transport-only (schema-correct names)', () => {
  // Codex uses slash-separated namespaces. The legacy camelCase names
  // (account/loginCompleted, thread/statusChanged) do NOT exist in
  // ServerNotification.
  const transportOnly = [
    'thread/started',
    'thread/closed',
    'thread/status/changed',
    'turn/started',
    'account/updated',
    'account/login/completed',
    'account/rateLimits/updated',
    'guardianWarning',
    'configWarning',
    'deprecationNotice',
    'process/outputDelta',
    'process/exited',
    'model/rerouted',
    'model/verification',
    'serverRequest/resolved',
  ];
  for (const method of transportOnly) {
    it(`${method} returns null`, () => {
      assert.equal(translateCodexNotification(method, {}, ctx), null);
    });
  }
});

describe('translateCodexNotification — unknown fallback', () => {
  it('unknown method → unknown_item with codex.<method> sourceType', () => {
    const event = translateCodexNotification(
      'someBrandNewCodexNotification',
      { foo: 1 },
      ctx,
    );
    if (event?.type !== 'unknown_item') throw new Error('unreachable');
    assert.equal(event.sourceType, 'codex.someBrandNewCodexNotification');
    assert.deepEqual(event.payload, { foo: 1 });
  });
});

describe('translateCodexApproval — server-to-client request → canonical permission_request', () => {
  const baseArgs = { sessionId: 's1', requestId: 'r1' };

  it('item/commandExecution/requestApproval → Bash subject with command (string per schema)', () => {
    // Per CommandExecutionRequestApprovalParams: command is a string,
    // not array. This is the canonical (current) approval method.
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 't',
        turnId: 'u',
        itemId: 'i',
        startedAtMs: 1700000000000,
        command: 'rm -rf /tmp/foo',
        cwd: '/tmp',
        reason: 'destructive command requires confirmation',
      },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.toolName, 'Bash');
    assert.equal(event.subject, 'Bash · rm -rf /tmp/foo');
    assert.match(event.details ?? '', /cwd: \/tmp/);
    assert.match(event.details ?? '', /destructive/);
  });

  it('legacy execCommandApproval (command: string[]) → joined for display', () => {
    // ExecCommandApprovalParams (legacy) has command: Array<string>.
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'execCommandApproval',
      params: { command: ['rm', '-rf', '/tmp/foo'], cwd: '/tmp', reason: 'destructive' },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.subject, 'Bash · rm -rf /tmp/foo');
  });

  it('item/fileChange/requestApproval → Patch (reason carried through details)', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 't',
        turnId: 'u',
        itemId: 'fc-9',
        startedAtMs: 1700000000000,
        reason: 'patch 3 files in /tmp',
      },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.toolName, 'Patch');
    assert.equal(event.subject, 'Patch');
    assert.match(event.details ?? '', /patch 3 files/);
  });

  it('legacy applyPatchApproval (has fileChanges map) → "Patch · N files"', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'applyPatchApproval',
      params: {
        fileChanges: { '/a.md': {}, '/b.md': {}, '/c.md': {} },
        reason: 'agent wants to refactor 3 files',
      },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.subject, 'Patch · 3 files');
  });

  it('item/permissions/requestApproval → Permissions request', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'item/permissions/requestApproval',
      params: { reason: 'elevate sandbox' },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.toolName, 'Permissions');
  });

  it('unknown approval kind → permission_unavailable (conservative default)', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'codex.brandNewApproval',
      params: {},
    });
    if (event.type !== 'permission_unavailable') throw new Error('unreachable');
    assert.match(event.reason, /codex\.brandNewApproval/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Guardrail: every method name the mapper recognises must exist in the
// upstream `ServerNotification.ts` union. Tests load the schema file at
// boot — when Codex renames a method, this test fires before the
// mapper hits a real session.
// ─────────────────────────────────────────────────────────────────────

describe('Codex method-name guardrail vs upstream ServerNotification', () => {
  const schemaPath = path.resolve(
    __dirname,
    '../../../资料/codex/codex-rs/app-server-protocol/schema/typescript/ServerNotification.ts',
  );

  function loadSchemaMethods(): Set<string> | null {
    if (!fs.existsSync(schemaPath)) return null;
    const src = fs.readFileSync(schemaPath, 'utf8');
    const methods = new Set<string>();
    for (const m of src.matchAll(/"method":\s*"([^"]+)"/g)) {
      methods.add(m[1]);
    }
    return methods;
  }

  it('every known Codex notification method appears in ServerNotification.ts', () => {
    const schema = loadSchemaMethods();
    if (!schema) {
      // Schema not present (codex repo not cloned into 资料/codex).
      // Don't fail the unit harness — Phase 5 plan calls out the
      // clone as a developer prerequisite. The guardrail still pins
      // method-name correctness for any environment that does have
      // the schema (CI, local dev with codex installed).
      return;
    }
    const unknown = CODEX_KNOWN_NOTIFICATION_METHODS.filter((m) => !schema.has(m));
    assert.deepEqual(
      unknown,
      [],
      `event-mapper references method names not present in upstream ServerNotification: ${unknown.join(', ')}`,
    );
  });
});
