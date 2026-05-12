/**
 * Phase 0.5 Slice D — Permission adapter translators.
 *
 * Pins the adapter-side translation contract: each runtime's native
 * approval / sandbox / confirm shape collapses into the canonical
 * 4-event `RuntimePermissionEvent` union. UI consumes only the
 * union; adapters never let their native shape leak past this layer.
 *
 * Slice D adds the ClaudeCode SDK translator + 3 terminal-event
 * helpers (granted / denied / unavailable). Codex slice adds
 * `translateCodexApproval` alongside without changing the UI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  translateClaudeCodePermissionRequest,
  emitPermissionGranted,
  emitPermissionDenied,
  emitPermissionUnavailable,
} from '@/lib/runtime/permission-adapter';
import type { PermissionRequestEvent } from '@/types';

describe('translateClaudeCodePermissionRequest', () => {
  it('maps SDK fields into the canonical permission_request shape', () => {
    const sdk: PermissionRequestEvent = {
      permissionRequestId: 'req-001',
      toolName: 'Bash',
      toolInput: { cmd: 'rm -rf /' },
      toolUseId: 'tu-1',
      description: 'Run shell command',
      decisionReason: 'destructive_path',
      blockedPath: '/',
    };
    const canonical = translateClaudeCodePermissionRequest(sdk, 'session-xyz');
    assert.equal(canonical.type, 'permission_request');
    assert.equal(canonical.runtimeId, 'claude_code');
    assert.equal(canonical.sessionId, 'session-xyz');
    assert.equal(canonical.requestId, 'req-001');
    assert.equal(canonical.subject, 'Bash · /');
    assert.equal(canonical.details, 'Run shell command\ndestructive_path');
  });

  it('omits details when neither description nor decisionReason is set', () => {
    const sdk: PermissionRequestEvent = {
      permissionRequestId: 'req-002',
      toolName: 'Read',
      toolInput: { path: '/etc/passwd' },
      toolUseId: 'tu-2',
    };
    const canonical = translateClaudeCodePermissionRequest(sdk, 's');
    assert.equal(canonical.subject, 'Read');
    assert.equal(canonical.details, undefined);
  });

  it('preserves the SDK requestId verbatim so resume can echo it back', () => {
    const sdk: PermissionRequestEvent = {
      permissionRequestId: 'pr_abc_123-xyz',
      toolName: 'Edit',
      toolInput: {},
      toolUseId: 'tu-3',
    };
    const canonical = translateClaudeCodePermissionRequest(sdk, 's');
    assert.equal(canonical.requestId, 'pr_abc_123-xyz');
  });
});

describe('Terminal-event helpers', () => {
  it('emitPermissionGranted produces a minimal granted event', () => {
    const e = emitPermissionGranted('claude_code', 's', 'r');
    assert.deepEqual(e, {
      type: 'permission_granted',
      runtimeId: 'claude_code',
      sessionId: 's',
      requestId: 'r',
    });
  });

  it('emitPermissionDenied omits reason when not provided', () => {
    const e = emitPermissionDenied('claude_code', 's', 'r');
    assert.deepEqual(e, {
      type: 'permission_denied',
      runtimeId: 'claude_code',
      sessionId: 's',
      requestId: 'r',
    });
  });

  it('emitPermissionDenied carries the reason when provided', () => {
    const e = emitPermissionDenied('claude_code', 's', 'r', 'user clicked deny');
    assert.equal(e.type, 'permission_denied');
    assert.equal((e as { reason?: string }).reason, 'user clicked deny');
  });

  it('emitPermissionUnavailable always carries a reason — conservative default', () => {
    const e = emitPermissionUnavailable(
      'codepilot_runtime',
      's',
      'r',
      'adapter does not map this approval kind yet',
    );
    assert.equal(e.type, 'permission_unavailable');
    assert.equal(e.reason, 'adapter does not map this approval kind yet');
    // Conservative default contract: this event must NEVER imply granted.
    // The fact that the type exists distinguishes it from granted at the
    // type level — UI is forced to render it differently.
    assert.notEqual(e.type as string, 'permission_granted');
  });
});

describe('Conservative default contract', () => {
  it('permission_unavailable is the documented escape hatch for unknown semantics', () => {
    // Implementer guidance check: when an adapter encounters an
    // approval event it can't classify, it MUST emit
    // permission_unavailable (not fall-through to granted). This
    // test is a documentation pin — failing it means someone removed
    // emitPermissionUnavailable from the public API.
    assert.equal(typeof emitPermissionUnavailable, 'function');
  });
});
