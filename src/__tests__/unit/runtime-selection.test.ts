/**
 * runtime-selection.test.ts — Tests for runtime selection logic.
 *
 * Covers: predictNativeRuntime decision tree, resolveRuntime auto semantics,
 * and OpenAI OAuth status derivation.
 *
 * These are inlined simplified versions of the logic (can't import Next.js
 * route modules directly in node:test).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined logic: predictNativeRuntime ────────────────────────────

function predictNativeRuntime(
  providerId: string | undefined,
  cliEnabled: boolean,
  agentRuntime: string,
  sdkAvailable: boolean
): boolean {
  if (providerId === 'openai-oauth') return true;
  if (!cliEnabled) return true;
  if (agentRuntime === 'native') return true;
  if (agentRuntime === 'claude-code-sdk') return false;
  // auto: prefer SDK if available
  if (sdkAvailable) return false;
  return true;
}

// ── Inlined logic: resolveRuntime ──────────────────────────────────

function resolveRuntime(
  cliDisabled: boolean,
  overrideId: string | undefined,
  settingId: string | undefined,
  sdkAvailable: boolean,
  nativeAvailable: boolean
): string {
  if (cliDisabled) return 'native';
  if (overrideId && overrideId !== 'auto') return overrideId;
  if (settingId && settingId !== 'auto') return settingId;
  if (sdkAvailable) return 'claude-code-sdk';
  if (nativeAvailable) return 'native';
  return 'native';
}

// ── Inlined logic: getOAuthStatus ──────────────────────────────────

function getOAuthStatus(
  accessToken: string | null,
  expiresAt: number,
  refreshToken: string | null
): { authenticated: boolean; needsRefresh?: boolean } {
  if (!accessToken) return { authenticated: false };
  if (expiresAt && Date.now() > expiresAt && !refreshToken)
    return { authenticated: false };
  const needsRefresh =
    expiresAt > 0 && Date.now() > expiresAt - 5 * 60 * 1000;
  return { authenticated: true, needsRefresh };
}

// ── predictNativeRuntime tests ─────────────────────────────────────

describe('predictNativeRuntime', () => {
  it('openai-oauth provider → always native', () => {
    // Should return true regardless of other parameters
    assert.equal(predictNativeRuntime('openai-oauth', true, 'auto', true), true);
    assert.equal(predictNativeRuntime('openai-oauth', false, 'claude-code-sdk', true), true);
    assert.equal(predictNativeRuntime('openai-oauth', true, 'claude-code-sdk', true), true);
  });

  it('cli_enabled=false → always native', () => {
    assert.equal(predictNativeRuntime('anthropic', false, 'auto', true), true);
    assert.equal(predictNativeRuntime('anthropic', false, 'claude-code-sdk', true), true);
    assert.equal(predictNativeRuntime(undefined, false, 'auto', false), true);
  });

  it('agent_runtime=native → native', () => {
    assert.equal(predictNativeRuntime('anthropic', true, 'native', true), true);
    assert.equal(predictNativeRuntime('anthropic', true, 'native', false), true);
  });

  it('agent_runtime=claude-code-sdk → not native', () => {
    assert.equal(predictNativeRuntime('anthropic', true, 'claude-code-sdk', true), false);
    assert.equal(predictNativeRuntime('anthropic', true, 'claude-code-sdk', false), false);
  });

  it('auto + SDK available → not native (prefers SDK)', () => {
    assert.equal(predictNativeRuntime('anthropic', true, 'auto', true), false);
    assert.equal(predictNativeRuntime(undefined, true, 'auto', true), false);
  });

  it('auto + SDK not available → native', () => {
    assert.equal(predictNativeRuntime('anthropic', true, 'auto', false), true);
    assert.equal(predictNativeRuntime(undefined, true, 'auto', false), true);
  });
});

// ── resolveRuntime tests ───────────────────────────────────────────

describe('resolveRuntime', () => {
  it('cli disabled → native regardless of other settings', () => {
    assert.equal(resolveRuntime(true, 'claude-code-sdk', 'claude-code-sdk', true, true), 'native');
    assert.equal(resolveRuntime(true, undefined, undefined, true, true), 'native');
    assert.equal(resolveRuntime(true, 'auto', 'auto', true, false), 'native');
  });

  it('explicit override=claude-code-sdk → sdk', () => {
    assert.equal(resolveRuntime(false, 'claude-code-sdk', undefined, true, true), 'claude-code-sdk');
    assert.equal(resolveRuntime(false, 'claude-code-sdk', 'native', false, true), 'claude-code-sdk');
  });

  it('explicit override=native → native', () => {
    assert.equal(resolveRuntime(false, 'native', undefined, true, true), 'native');
    assert.equal(resolveRuntime(false, 'native', 'claude-code-sdk', true, true), 'native');
  });

  it('setting=native → native', () => {
    assert.equal(resolveRuntime(false, undefined, 'native', true, true), 'native');
    assert.equal(resolveRuntime(false, 'auto', 'native', true, true), 'native');
  });

  it('setting=claude-code-sdk → sdk', () => {
    assert.equal(resolveRuntime(false, undefined, 'claude-code-sdk', true, true), 'claude-code-sdk');
    assert.equal(resolveRuntime(false, 'auto', 'claude-code-sdk', false, true), 'claude-code-sdk');
  });

  it('auto + both available → sdk (prefers SDK)', () => {
    assert.equal(resolveRuntime(false, undefined, undefined, true, true), 'claude-code-sdk');
    assert.equal(resolveRuntime(false, 'auto', 'auto', true, true), 'claude-code-sdk');
  });

  it('auto + only native → native', () => {
    assert.equal(resolveRuntime(false, undefined, undefined, false, true), 'native');
    assert.equal(resolveRuntime(false, 'auto', 'auto', false, true), 'native');
  });
});

// ── OpenAI OAuth status tests ──────────────────────────────────────

describe('getOAuthStatus', () => {
  it('no token → not authenticated', () => {
    const result = getOAuthStatus(null, 0, null);
    assert.equal(result.authenticated, false);
    assert.equal(result.needsRefresh, undefined);
  });

  it('valid token (not near expiry) → authenticated, no refresh needed', () => {
    const farFuture = Date.now() + 60 * 60 * 1000; // 1 hour from now
    const result = getOAuthStatus('access-token-123', farFuture, null);
    assert.equal(result.authenticated, true);
    assert.equal(result.needsRefresh, false);
  });

  it('expired token + no refresh → not authenticated', () => {
    const past = Date.now() - 60 * 1000; // 1 minute ago
    const result = getOAuthStatus('access-token-123', past, null);
    assert.equal(result.authenticated, false);
  });

  it('expired token + has refresh → authenticated + needsRefresh=true', () => {
    const past = Date.now() - 60 * 1000; // 1 minute ago
    const result = getOAuthStatus('access-token-123', past, 'refresh-token-456');
    assert.equal(result.authenticated, true);
    assert.equal(result.needsRefresh, true);
  });

  it('token near expiry (within 5min buffer) → needsRefresh=true', () => {
    const nearExpiry = Date.now() + 2 * 60 * 1000; // 2 minutes from now (within 5min buffer)
    const result = getOAuthStatus('access-token-123', nearExpiry, null);
    assert.equal(result.authenticated, true);
    assert.equal(result.needsRefresh, true);
  });

  it('token exactly at 5min boundary → needsRefresh=true', () => {
    // expiresAt is exactly 5 minutes from now: Date.now() > expiresAt - 5*60*1000
    // means Date.now() > Date.now(), which is false. So needsRefresh = false.
    // But if expiresAt is 5min - 1ms from now, needsRefresh = true.
    const exactBoundary = Date.now() + 5 * 60 * 1000;
    const resultAt = getOAuthStatus('access-token-123', exactBoundary, null);
    assert.equal(resultAt.authenticated, true);
    assert.equal(resultAt.needsRefresh, false); // exactly at boundary, not past it

    const justInside = Date.now() + 5 * 60 * 1000 - 1;
    const resultInside = getOAuthStatus('access-token-123', justInside, null);
    assert.equal(resultInside.authenticated, true);
    assert.equal(resultInside.needsRefresh, true);
  });

  it('token with expiresAt=0 → authenticated, no refresh needed', () => {
    // expiresAt=0 is falsy, so the expiry check is skipped entirely
    const result = getOAuthStatus('access-token-123', 0, null);
    assert.equal(result.authenticated, true);
    assert.equal(result.needsRefresh, false);
  });
});
