/**
 * chat-runtime.test.ts — regression coverage for the runtime registry
 * import side effect.
 *
 * Background: chat-runtime.ts MUST import resolveRuntime via the
 * `runtime/index.ts` barrel, not directly from `runtime/registry.ts`.
 * The barrel calls `registerRuntime(nativeRuntime)` and
 * `registerRuntime(sdkRuntime)` at import time; pulling resolveRuntime
 * from the registry module skips that registration. When
 * `/api/providers/models?runtime=auto` was the first runtime consumer
 * in a request's dep graph, the registry was empty and resolveRuntime
 * threw "No agent runtime registered" — surfacing as a 500 to the
 * picker / chat page init.
 *
 * These tests reproduce that path: importing chat-runtime alone (no
 * other code that already triggered the barrel) and calling
 * getActiveChatRuntime() must succeed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getActiveChatRuntime, isChatRuntimeParam, resolveChatRuntimeParam, chatRuntimeParamForSession } from '../../lib/chat-runtime';
import { getSetting, setSetting } from '../../lib/db';

describe('chat-runtime registry side effects', () => {
  it('getActiveChatRuntime() does not throw when chat-runtime is the entry import', () => {
    // The actual regression: importing chat-runtime above and immediately
    // calling getActiveChatRuntime() must NOT throw "No agent runtime
    // registered". If this test starts failing with that message,
    // chat-runtime.ts has been changed back to import from
    // ./runtime/registry instead of the ./runtime barrel.
    assert.doesNotThrow(() => getActiveChatRuntime());
  });

  it('returns one of the two valid ChatRuntime labels', () => {
    const result = getActiveChatRuntime();
    assert.ok(
      result === 'claude_code' || result === 'codepilot_runtime',
      `expected 'claude_code' | 'codepilot_runtime', got ${result}`,
    );
  });

  it('agent_runtime=native → codepilot_runtime (deterministic — no env dependency)', () => {
    const saved = getSetting('agent_runtime');
    setSetting('agent_runtime', 'native');
    try {
      assert.equal(getActiveChatRuntime(), 'codepilot_runtime');
    } finally {
      setSetting('agent_runtime', saved || '');
    }
  });

  it('cli_enabled=false → codepilot_runtime regardless of agent_runtime', () => {
    const savedCli = getSetting('cli_enabled');
    const savedRt = getSetting('agent_runtime');
    setSetting('cli_enabled', 'false');
    setSetting('agent_runtime', 'claude-code-sdk');
    try {
      // cli_disabled is the highest-priority constraint in resolveRuntime.
      assert.equal(getActiveChatRuntime(), 'codepilot_runtime');
    } finally {
      setSetting('cli_enabled', savedCli || '');
      setSetting('agent_runtime', savedRt || '');
    }
  });
});

describe('chat-runtime param helpers', () => {
  it('isChatRuntimeParam accepts the three valid values, rejects everything else', () => {
    assert.equal(isChatRuntimeParam('auto'), true);
    assert.equal(isChatRuntimeParam('claude_code'), true);
    assert.equal(isChatRuntimeParam('codepilot_runtime'), true);
    assert.equal(isChatRuntimeParam(''), false);
    assert.equal(isChatRuntimeParam(null), false);
    assert.equal(isChatRuntimeParam(undefined), false);
    assert.equal(isChatRuntimeParam('claude-code'), false);
  });

  it('resolveChatRuntimeParam passes explicit values through, resolves auto', () => {
    assert.equal(resolveChatRuntimeParam('claude_code'), 'claude_code');
    assert.equal(resolveChatRuntimeParam('codepilot_runtime'), 'codepilot_runtime');
    const auto = resolveChatRuntimeParam('auto');
    assert.ok(auto === 'claude_code' || auto === 'codepilot_runtime');
  });
});

describe('chatRuntimeParamForSession (Phase 2 Step 3b)', () => {
  it('valid pin → that pin (immune to global)', () => {
    assert.equal(chatRuntimeParamForSession('claude_code'), 'claude_code');
    assert.equal(chatRuntimeParamForSession('codepilot_runtime'), 'codepilot_runtime');
  });

  it('empty / undefined / null → "auto" (follow global)', () => {
    assert.equal(chatRuntimeParamForSession(''), 'auto');
    assert.equal(chatRuntimeParamForSession(undefined), 'auto');
    assert.equal(chatRuntimeParamForSession(null), 'auto');
  });

  it('legacy / corrupt unknown value → "auto" (defensive)', () => {
    // If a future legacy row holds a stale label form ('sdk', 'claude-code'),
    // we'd rather fall through to global than route the picker into an
    // unrecognized state. The downstream useProviderModels server filter
    // is the second line of defense.
    assert.equal(chatRuntimeParamForSession('sdk'), 'auto');
    assert.equal(chatRuntimeParamForSession('claude-code'), 'auto');
    assert.equal(chatRuntimeParamForSession('CLAUDE_CODE'), 'auto');
  });
});
