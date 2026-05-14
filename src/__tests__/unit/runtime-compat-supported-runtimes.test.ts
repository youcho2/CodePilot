/**
 * Phase 0.5 Slice B — `getModelCompat` populates `supportedRuntimes`
 * for every provider compat tier.
 *
 * Pins the migration from the two legacy `*_compatible` booleans to
 * the canonical `supportedRuntimes[]` field. Once readers (API route
 * filter, Slice E adapters) consume `supportedRuntimes` exclusively,
 * the legacy booleans become read-only back-compat input.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getModelCompat } from '@/lib/runtime-compat';
import type { ProviderRuntimeCompat } from '@/types';

function compatFor(tier: ProviderRuntimeCompat) {
  return getModelCompat({
    modelId: 'sample',
    providerCompat: tier,
  });
}

describe('getModelCompat → supportedRuntimes', () => {
  it('claude_code_ready exposes both legacy runtimes + codex_runtime proxy-pending reason', () => {
    // Phase 6 P0 (2026-05-15) — codex_runtime reach is shaped by the
    // CodePilot provider proxy, which is still scaffolded. Until the
    // translator lands per compat tier, every non-Codex provider
    // carries a `codex_runtime` reason ("proxy 尚未覆盖") so the
    // picker tooltip explains the disabled state correctly. Pre-P0
    // this field was undefined and the picker fell back to generic
    // copy.
    const cap = compatFor('claude_code_ready');
    assert.deepEqual([...(cap.supportedRuntimes ?? [])].sort(), [
      'claude_code',
      'codepilot_runtime',
    ]);
    assert.match(
      cap.unsupportedReasonByRuntime?.codex_runtime ?? '',
      /Codex provider proxy 尚未覆盖/,
    );
  });

  it('claude_code_verified exposes both runtimes', () => {
    const cap = compatFor('claude_code_verified');
    assert.deepEqual([...(cap.supportedRuntimes ?? [])].sort(), [
      'claude_code',
      'codepilot_runtime',
    ]);
  });

  it('claude_code_experimental exposes both runtimes', () => {
    const cap = compatFor('claude_code_experimental');
    assert.deepEqual([...(cap.supportedRuntimes ?? [])].sort(), [
      'claude_code',
      'codepilot_runtime',
    ]);
  });

  it('openrouter_anthropic_skin reaches Claude Code only + carries reason for CodePilot Runtime', () => {
    const cap = compatFor('openrouter_anthropic_skin');
    assert.deepEqual(cap.supportedRuntimes, ['claude_code']);
    assert.ok(cap.unsupportedReasonByRuntime?.codepilot_runtime);
    assert.match(
      cap.unsupportedReasonByRuntime!.codepilot_runtime!,
      /OpenRouter|skin|\/v1/,
    );
  });

  it('codepilot_only reaches CodePilot Runtime only + carries reason for Claude Code', () => {
    const cap = compatFor('codepilot_only');
    assert.deepEqual(cap.supportedRuntimes, ['codepilot_runtime']);
    assert.ok(cap.unsupportedReasonByRuntime?.claude_code);
    assert.match(
      cap.unsupportedReasonByRuntime!.claude_code!,
      /OpenAI|compatible|Claude Code/,
    );
  });

  it('unknown defaults to both runtimes visible (user verifies)', () => {
    const cap = compatFor('unknown');
    assert.deepEqual([...(cap.supportedRuntimes ?? [])].sort(), [
      'claude_code',
      'codepilot_runtime',
    ]);
  });

  it('media_only short-circuits — no supportedRuntimes set', () => {
    const cap = compatFor('media_only');
    assert.equal(cap.media, true);
    assert.equal(cap.supportedRuntimes, undefined);
  });

  it('codex_account exposes ONLY codex_runtime + carries reasons for the others', () => {
    // Phase 5 Phase 2 (2026-05-13) — Codex account models flow only
    // through Codex Runtime; legacy compat booleans stay unset.
    const cap = compatFor('codex_account');
    assert.deepEqual(cap.supportedRuntimes, ['codex_runtime']);
    assert.equal(cap.claude_code_compatible, undefined);
    assert.equal(cap.codepilot_runtime_compatible, undefined);
    assert.ok(cap.unsupportedReasonByRuntime?.claude_code);
    assert.ok(cap.unsupportedReasonByRuntime?.codepilot_runtime);
    assert.match(cap.unsupportedReasonByRuntime!.claude_code!, /Codex/);
  });

  it('legacy booleans still mirror supportedRuntimes (back-compat input)', () => {
    const cap = compatFor('claude_code_verified');
    assert.equal(cap.claude_code_compatible, true);
    assert.equal(cap.codepilot_runtime_compatible, true);
  });
});
