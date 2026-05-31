/**
 * P1 (2026-06-01) — Codex effort clamp regression.
 *
 * The codex_runtime `turn/start` path must never forward CodePilot's
 * Opus-only effort tiers (`xhigh` / `max`) to the Codex app-server, which
 * only accepts `minimal | low | medium | high`. Older codex builds reject
 * unknown variants fatally; even 0.133 only tolerates them with a warning.
 *
 * Scope guard: this clamp is codex-only. Claude Code / Native must keep the
 * full union for Anthropic Opus 4.7/4.8 — they do NOT import clampCodexEffort.
 *
 * See docs/research/packaged-preview-runtime-diagnosis-2026-05-31.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clampCodexEffort, CODEX_SUPPORTED_EFFORTS } from '@/lib/codex/effort';

describe('clampCodexEffort — Opus-only tiers clamp to high', () => {
  it('maps xhigh → high', () => {
    assert.equal(clampCodexEffort('xhigh'), 'high');
  });

  it('maps max → high', () => {
    assert.equal(clampCodexEffort('max'), 'high');
  });
});

describe('clampCodexEffort — Codex-supported levels pass through unchanged', () => {
  for (const level of ['minimal', 'low', 'medium', 'high'] as const) {
    it(`keeps ${level} as-is`, () => {
      assert.equal(clampCodexEffort(level), level);
    });
  }
});

describe('clampCodexEffort — absent / unknown is omitted (let Codex default)', () => {
  it('returns undefined for undefined', () => {
    assert.equal(clampCodexEffort(undefined), undefined);
  });
  it('returns undefined for null', () => {
    assert.equal(clampCodexEffort(null), undefined);
  });
  it('returns undefined for empty string', () => {
    assert.equal(clampCodexEffort(''), undefined);
  });
  it('returns undefined for an unrecognized value rather than forwarding it', () => {
    assert.equal(clampCodexEffort('ultra-mega'), undefined);
  });
});

describe('CODEX_SUPPORTED_EFFORTS — contract', () => {
  it('is exactly the four levels Codex accepts (no xhigh/max)', () => {
    assert.deepEqual([...CODEX_SUPPORTED_EFFORTS], ['minimal', 'low', 'medium', 'high']);
  });
});
