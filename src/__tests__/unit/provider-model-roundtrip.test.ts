/**
 * tech-debt #37 (2026-06-03) — sessions silently displayed/sent the WRONG model.
 *
 * Real-data root cause (verified against ~/.codepilot/codepilot.db): many
 * persisted sessions store a *canonical* model id (`claude-opus-4-7`,
 * `claude-sonnet-4-6`, `claude-opus-4-6`, …) while the provider's picker rows
 * are *aliases* (`value: 'opus' | 'sonnet' | 'haiku'`) whose canonical id lives
 * on `upstreamModelId` (the preset merge in
 * `src/app/api/providers/models/route.ts` rewrites `upstream_model_id` to the
 * canonical id, e.g. `opus → claude-opus-4-7`). The old `value`-only match
 * (`modelOptions.find(m => m.value === modelName)`) could not match a canonical
 * id, so it fell through to `modelOptions[0]`. When the first row is Sonnet and
 * the saved model was canonical-Opus, the composer showed Sonnet and a
 * continue-send silently sent Sonnet — wrong cost & capability.
 *
 * Fix: `findModelOption` matches by alias `value` OR canonical `upstreamModelId`,
 * so a saved canonical id round-trips back to its alias row (which the backend
 * then re-canonicalizes on send). No runtime-gate change, no silent session PATCH.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findModelOption } from '@/hooks/useProviderModels';

// Mirrors the real OpenRouter / Anthropic-skin picker rows AFTER the preset
// merge: alias `value`, canonical `upstreamModelId`. `sonnet` is sort_order 0
// (FIRST) — i.e. the wrong fallback the bug produced for a canonical-Opus
// session. Canonical strings match the preset table (route.ts:34-50).
const ALIAS_ROWS = [
  { value: 'sonnet', upstreamModelId: 'claude-sonnet-4-6' },
  { value: 'opus', upstreamModelId: 'claude-opus-4-7' },
  { value: 'haiku', upstreamModelId: 'claude-haiku-4-5-20251001' },
];

describe('findModelOption — alias ↔ canonical round-trip (tech-debt #37)', () => {
  it('matches by alias value', () => {
    assert.equal(findModelOption(ALIAS_ROWS, 'opus')?.value, 'opus');
  });

  it('resolves a saved canonical Opus id to the opus row — NOT the first (Sonnet) row (the #37 silent-substitution guard)', () => {
    const row = findModelOption(ALIAS_ROWS, 'claude-opus-4-7');
    assert.equal(row?.value, 'opus', 'a saved claude-opus-4-7 must resolve to opus, not fall through to the first row');
    assert.notEqual(row?.value, 'sonnet');
  });

  it('resolves a saved canonical Sonnet id to the sonnet row', () => {
    assert.equal(findModelOption(ALIAS_ROWS, 'claude-sonnet-4-6')?.value, 'sonnet');
  });

  it('returns undefined for an unknown id (caller falls back to the group default)', () => {
    assert.equal(findModelOption(ALIAS_ROWS, 'anthropic/claude-opus-4.7'), undefined);
    assert.equal(findModelOption(ALIAS_ROWS, 'not-a-model'), undefined);
  });

  it('returns undefined for an empty / undefined id', () => {
    assert.equal(findModelOption(ALIAS_ROWS, undefined), undefined);
    assert.equal(findModelOption(ALIAS_ROWS, ''), undefined);
  });
});

describe('useProviderModels source — resolved model uses the round-trip matcher (#37)', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../../hooks/useProviderModels.ts'),
    'utf8',
  );
  it('resolvedModel resolves via findModelOption(...).value (not a value-only match)', () => {
    assert.match(src, /const resolvedModel = findModelOption\(modelOptions, modelName\)\?\.value/);
  });
  it('currentModelOption (picker display) uses findModelOption', () => {
    assert.match(src, /findModelOption\(modelOptions, currentModelValue\)/);
  });
});
