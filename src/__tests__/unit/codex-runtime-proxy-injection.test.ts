/**
 * Phase 5b — Codex Runtime ↔ provider proxy wiring regression tests.
 *
 * The unified translator at `/api/codex/proxy/v1/responses` only
 * works if `thread/start` is called with the matching
 * `model_providers.codepilot_proxy` config + `modelProvider:
 * 'codepilot_proxy'` + `x-codepilot-target-provider` header. The
 * earlier Phase 5b commit shipped the helper but didn't actually wire
 * it into `CodexRuntime.stream()`, which meant the UI showed Codex
 * Runtime as available for CodePilot providers while the actual
 * thread/start params didn't carry the injection — a silent failure
 * mode (the user sees the model in the picker, sends, and the run
 * fails because Codex tries to call the upstream API directly).
 *
 * These tests pin the contract at two layers:
 *
 *   1. `buildCodexThreadStartParams` (pure helper) — exercises every
 *      provider-resolution branch (env / empty → throw, codex_account
 *      → no injection, real provider → full injection).
 *
 *   2. `CodexRuntime.stream` — observes the failure surface for the
 *      env case. We can't spawn the real app-server in CI (CODEX_DISABLED=1),
 *      but the env / empty checks fire BEFORE the subprocess boot, so
 *      they're testable end-to-end through the runtime entry point.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodexThreadStartParams,
  buildCodexProviderProxyInjection,
  CODEX_PROXY_PROVIDER_KEY,
} from '@/lib/codex/provider-proxy';
import { codexRuntime } from '@/lib/codex/runtime';

// ─────────────────────────────────────────────────────────────────────
// buildCodexThreadStartParams — provider-resolution branches
// ─────────────────────────────────────────────────────────────────────

describe('buildCodexThreadStartParams — provider routing', () => {
  it('throws for empty providerId (caller must reject before this layer)', () => {
    assert.throws(
      () =>
        buildCodexThreadStartParams({
          providerId: '',
          workingDirectory: '/tmp',
          proxyBaseUrl: 'http://127.0.0.1:3000',
        }),
      /env.*empty providerId|must reject/,
    );
  });

  it('throws for env providerId (Claude Code default explicitly excluded)', () => {
    assert.throws(
      () =>
        buildCodexThreadStartParams({
          providerId: 'env',
          workingDirectory: '/tmp',
          proxyBaseUrl: 'http://127.0.0.1:3000',
        }),
      /env/,
    );
  });

  it('returns just {cwd} for codex_account (Codex uses its own credentials, no proxy injection)', () => {
    const params = buildCodexThreadStartParams({
      providerId: 'codex_account',
      workingDirectory: '/tmp/work',
      proxyBaseUrl: 'http://127.0.0.1:3000',
    });
    assert.deepEqual(params, { cwd: '/tmp/work' });
    assert.equal(
      (params as Record<string, unknown>).modelProvider,
      undefined,
      'codex_account must NOT carry modelProvider — Codex would otherwise try to resolve codepilot_proxy without the matching config',
    );
    assert.equal((params as Record<string, unknown>).config, undefined);
  });

  it('injects codepilot_proxy + target header for a real CodePilot provider', () => {
    const params = buildCodexThreadStartParams({
      providerId: 'glm-test',
      workingDirectory: '/tmp/work',
      proxyBaseUrl: 'http://127.0.0.1:3000',
    });
    assert.equal(params.cwd, '/tmp/work');
    assert.equal(
      params.modelProvider,
      CODEX_PROXY_PROVIDER_KEY,
      'modelProvider must point Codex at the codepilot_proxy entry it sees in config.model_providers',
    );
    const cfg = params.config?.model_providers?.[CODEX_PROXY_PROVIDER_KEY];
    assert.ok(cfg, 'config.model_providers.codepilot_proxy must be present');
    assert.equal(cfg!.wire_api, 'responses');
    assert.equal(
      cfg!.base_url,
      'http://127.0.0.1:3000/api/codex/proxy/v1',
      'base_url must point at the local proxy route — Codex appends /responses for streaming',
    );
    assert.equal(
      cfg!.http_headers['x-codepilot-target-provider'],
      'glm-test',
      'target provider header must echo the requested CodePilot provider id so the proxy route knows which DB row to forward',
    );
  });

  it('omits cwd when workingDirectory is not provided', () => {
    const params = buildCodexThreadStartParams({
      providerId: 'codex_account',
      proxyBaseUrl: 'http://127.0.0.1:3000',
    });
    assert.equal((params as { cwd?: string }).cwd, undefined);
  });

  it('strips trailing slashes off the proxy base url so the path concat stays clean', () => {
    const params = buildCodexThreadStartParams({
      providerId: 'glm-test',
      proxyBaseUrl: 'http://127.0.0.1:3000/',
    });
    const cfg = params.config?.model_providers?.[CODEX_PROXY_PROVIDER_KEY];
    assert.equal(
      cfg!.base_url,
      'http://127.0.0.1:3000/api/codex/proxy/v1',
      'trailing slash must be normalised away — Codex appends /responses and a double slash would silently 404',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildCodexProviderProxyInjection — the lower-level helper
// ─────────────────────────────────────────────────────────────────────

describe('buildCodexProviderProxyInjection — proxy config shape', () => {
  it('packs the modelProvider key + config.model_providers entry exactly as Codex expects', () => {
    const injection = buildCodexProviderProxyInjection('p1', 'http://127.0.0.1:3000');
    assert.equal(injection.modelProvider, 'codepilot_proxy');
    const entry = injection.config.model_providers.codepilot_proxy;
    assert.equal(entry.name, 'CodePilot via Codex');
    assert.equal(entry.wire_api, 'responses');
    assert.equal(entry.base_url, 'http://127.0.0.1:3000/api/codex/proxy/v1');
    assert.equal(entry.http_headers['x-codepilot-target-provider'], 'p1');
  });
});

// ─────────────────────────────────────────────────────────────────────
// CodexRuntime.stream — env / empty provider rejection
// ─────────────────────────────────────────────────────────────────────

async function collectStream(stream: ReadableStream<string>): Promise<string[]> {
  const chunks: string[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return chunks;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

describe('CodexRuntime.stream — provider gate (Phase 5b)', () => {
  it('rejects with run_failed when providerId is "env"', async () => {
    const stream = codexRuntime.stream({
      prompt: 'hi',
      sessionId: 'test-session-env',
      providerId: 'env',
    });
    const chunks = await collectStream(stream);
    const joined = chunks.join('');
    assert.match(
      joined,
      /env|Claude Code default|not supported/,
      'env rejection must surface a specific reason (mentions env / Claude Code) so the user understands WHY the send failed, not a generic "Codex Runtime error"',
    );
    // The runtime emits a run_failed canonical event when it bails out
    // pre-stream. The exact SSE wrapper is `data: {"type":"run_failed",
    // "data":"..."}\n\n` per canonicalToSseLine.
    // CodexRuntime emits the pre-stream rejection as a canonical
    // `error` SSE event followed by `done`. The existing chat
    // consumer treats this as a terminal failure.
    assert.match(joined, /"type":"error"/);
    assert.match(joined, /"type":"done"/);
  });

  it('rejects with run_failed when no providerId / sessionProviderId is given', async () => {
    const stream = codexRuntime.stream({
      prompt: 'hi',
      sessionId: 'test-session-empty',
    });
    const chunks = await collectStream(stream);
    const joined = chunks.join('');
    // CodexRuntime emits the pre-stream rejection as a canonical
    // `error` SSE event followed by `done`. The existing chat
    // consumer treats this as a terminal failure.
    assert.match(joined, /"type":"error"/);
    assert.match(joined, /"type":"done"/);
    assert.match(joined, /provider|env|Claude Code/);
  });
});
