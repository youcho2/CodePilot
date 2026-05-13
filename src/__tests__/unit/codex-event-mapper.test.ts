/**
 * Phase 5 Phase 3 — Codex notification → canonical event mapping.
 *
 * Pins the wire-level translation contract:
 *
 *   - assistant deltas + reasoning deltas → `assistant_delta`
 *   - item lifecycle (started / completed) → tool_started /
 *     tool_completed; commandExecution items → `command_started`
 *   - thread/tokenUsage/updated → `usage_updated`
 *   - turn/completed / turn/failed → `run_completed` / `run_failed`
 *   - fs/changed → `file_changed`
 *   - keep_alive / account/* / etc → null (transport-only or
 *     handled on a different channel)
 *   - unknown method → `unknown_item` (fallback contract)
 *
 * Approval translator covers the canonical permission_request shape
 * + conservative `permission_unavailable` for unknown approval kinds.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  translateCodexNotification,
  translateCodexApproval,
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

  it('reasoningText/delta also maps to assistant_delta', () => {
    const event = translateCodexNotification(
      'item/reasoningText/delta',
      { delta: 'thinking…' },
      ctx,
    );
    assert.equal(event?.type, 'assistant_delta');
  });
});

describe('translateCodexNotification — item lifecycle', () => {
  it('item/started with commandExecution → command_started', () => {
    const event = translateCodexNotification(
      'item/started',
      {
        itemId: 'cmd-1',
        item: { type: 'commandExecution', command: ['ls', '-la'], cwd: '/tmp' },
      },
      ctx,
    );
    assert.equal(event?.type, 'command_started');
    if (event?.type !== 'command_started') throw new Error('unreachable');
    assert.equal(event.commandId, 'cmd-1');
    assert.equal(event.command, 'ls -la');
    assert.equal(event.cwd, '/tmp');
  });

  it('item/started with generic tool → tool_started', () => {
    const event = translateCodexNotification(
      'item/started',
      { itemId: 't-1', item: { type: 'webSearch', name: 'web_search' } },
      ctx,
    );
    assert.equal(event?.type, 'tool_started');
    if (event?.type !== 'tool_started') throw new Error('unreachable');
    assert.equal(event.toolId, 't-1');
    assert.equal(event.name, 'web_search');
  });

  it('item/completed → tool_completed with output / error', () => {
    const ok = translateCodexNotification(
      'item/completed',
      { itemId: 't-1', item: { output: 'result text' } },
      ctx,
    );
    assert.equal(ok?.type, 'tool_completed');
    if (ok?.type !== 'tool_completed') throw new Error('unreachable');
    assert.equal(ok.output, 'result text');

    const fail = translateCodexNotification(
      'item/completed',
      { itemId: 't-2', item: { error: 'sandbox blocked' } },
      ctx,
    );
    if (fail?.type !== 'tool_completed') throw new Error('unreachable');
    assert.equal(fail.error, 'sandbox blocked');
  });
});

describe('translateCodexNotification — turn lifecycle', () => {
  it('turn/completed → run_completed', () => {
    const event = translateCodexNotification('turn/completed', { status: 'end_turn' }, ctx);
    assert.equal(event?.type, 'run_completed');
    if (event?.type !== 'run_completed') throw new Error('unreachable');
    assert.equal(event.finishReason, 'end_turn');
  });

  it('turn/failed → run_failed', () => {
    const event = translateCodexNotification(
      'turn/failed',
      { code: 'rate_limited', message: 'try again later' },
      ctx,
    );
    assert.equal(event?.type, 'run_failed');
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.equal(event.code, 'rate_limited');
    assert.equal(event.message, 'try again later');
  });

  it('error notification → run_failed with code stringified', () => {
    const event = translateCodexNotification(
      'error',
      { code: -32601, message: 'method not found' },
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.equal(event.code, '-32601');
  });
});

describe('translateCodexNotification — token usage + file changes', () => {
  it('thread/tokenUsage/updated → usage_updated with contextWindow', () => {
    const event = translateCodexNotification(
      'thread/tokenUsage/updated',
      { inputTokens: 100, outputTokens: 50, modelContextWindow: 200_000 },
      ctx,
    );
    assert.equal(event?.type, 'usage_updated');
    if (event?.type !== 'usage_updated') throw new Error('unreachable');
    assert.equal(event.contextWindow, 200_000);
  });

  it('fs/changed → file_changed with paths array', () => {
    const event = translateCodexNotification(
      'fs/changed',
      { watchId: 'w1', changedPaths: ['/tmp/a.md', '/tmp/b.md'] },
      ctx,
    );
    assert.equal(event?.type, 'file_changed');
    if (event?.type !== 'file_changed') throw new Error('unreachable');
    assert.deepEqual([...event.paths], ['/tmp/a.md', '/tmp/b.md']);
  });

  it('fs/changed with empty paths returns null', () => {
    const event = translateCodexNotification('fs/changed', { changedPaths: [] }, ctx);
    assert.equal(event, null);
  });
});

describe('translateCodexNotification — transport-only', () => {
  const transportOnly = [
    'keep_alive',
    'thread/started',
    'thread/closed',
    'turn/started',
    'account/updated',
    'account/loginCompleted',
    'process/outputDelta',
    'guardian/warning',
  ];
  for (const method of transportOnly) {
    it(`${method} returns null (no chat event)`, () => {
      const event = translateCodexNotification(method, {}, ctx);
      assert.equal(event, null);
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
    assert.equal(event?.type, 'unknown_item');
    if (event?.type !== 'unknown_item') throw new Error('unreachable');
    assert.equal(event.sourceType, 'codex.someBrandNewCodexNotification');
    assert.deepEqual(event.payload, { foo: 1 });
  });
});

describe('translateCodexApproval — server → canonical permission_request', () => {
  const baseArgs = { sessionId: 's1', requestId: 'r1' };

  it('execCommandApproval → permission_request with Bash subject', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'execCommandApproval',
      params: { command: ['rm', '-rf', '/tmp/foo'], cwd: '/tmp', reason: 'destructive' },
    });
    assert.equal(event.type, 'permission_request');
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.toolName, 'Bash');
    assert.equal(event.subject, 'Bash · rm -rf /tmp/foo');
    assert.match(event.details ?? '', /cwd: \/tmp/);
    assert.ok(event.nativeRequestRef);
  });

  it('applyPatchApproval → permission_request with Patch subject + file count', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'applyPatchApproval',
      params: {
        fileChanges: { '/tmp/a.md': {}, '/tmp/b.md': {}, '/tmp/c.md': {} },
        reason: 'agent wants to refactor 3 files',
      },
    });
    assert.equal(event.type, 'permission_request');
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.toolName, 'Patch');
    assert.equal(event.subject, 'Patch · 3 files');
    assert.match(event.details ?? '', /refactor/);
  });

  it('item/permissions/requestApproval → permission_request with Permissions tool', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'item/permissions/requestApproval',
      params: { reason: 'elevate sandbox' },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.toolName, 'Permissions');
    assert.equal(event.subject, 'Codex requests elevated permissions');
  });

  it('unknown approval kind → permission_unavailable (conservative default)', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'codex.brandNewApproval',
      params: {},
    });
    assert.equal(event.type, 'permission_unavailable');
    if (event.type !== 'permission_unavailable') throw new Error('unreachable');
    assert.match(event.reason, /codex\.brandNewApproval/);
  });
});
