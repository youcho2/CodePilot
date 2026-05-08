/**
 * use-context-usage-output-only-skip.test.ts — contract for the
 * output-only token_usage skip + SDK context_window preservation in
 * `useContextUsage` and its underlying walk helper.
 *
 * The behavioral piece — message walk, baseline picking,
 * latestSdkContextWindow capture — has its own behavioral test
 * (`context-usage-walk.test.ts`). This file locks the *contracts*:
 *
 *   • The walk helper actually contains the skip predicates and the
 *     newest-wins context_window capture (so a future inline rewrite
 *     can't silently regress).
 *   • The hook actually consumes the helper (so a future "let's
 *     inline this back" refactor doesn't silently drop the helper's
 *     guarantees while leaving the test passing).
 *   • The hook resolves contextWindow with the documented priority
 *     chain: baseline.context_window → latestSdkContextWindow →
 *     catalogContextWindow.
 *
 * Background (2026-05-08): two regressions in one week —
 *   #1: output-only tail records zeroed `used`.
 *   #2: skipping those records also dropped their authoritative
 *       `context_window`, sending GLM / Bailian / etc. back to
 *       "capacity unknown."
 * Both fixes anchored here so the next refactor doesn't repeat
 * either mistake.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.join(__dirname, '..', '..');

describe('context-usage-walk — skip + context_window preservation', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'lib/context-usage-walk.ts'),
    'utf8',
  );

  it('skips records with used===0 && outputTokens>0 (regression #1)', () => {
    assert.match(
      src,
      /used\s*===\s*0\s*&&\s*outputTokens\s*>\s*0[\s\S]{0,40}continue/,
      'walkContextUsage must skip output-only records (used=0 + outputTokens>0) so the latest input/cache baseline isn\'t silently zeroed by a tail accounting record',
    );
  });

  it('skips records with all-zero usage', () => {
    assert.match(
      src,
      /used\s*===\s*0\s*&&\s*outputTokens\s*===\s*0[\s\S]{0,40}continue/,
      'walkContextUsage must skip all-zero records too — they have no context signal',
    );
  });

  it('walks from the end (newest meaningful record wins)', () => {
    assert.match(
      src,
      /for\s*\(\s*let\s+i\s*=\s*messages\.length\s*-\s*1\s*;\s*i\s*>=\s*0\s*;\s*i--\s*\)/,
      'walkContextUsage must walk messages from the end so the newest meaningful token_usage wins',
    );
  });

  it('captures latestSdkContextWindow BEFORE deciding to skip the record (regression #2)', () => {
    // The bug we're guarding against: pre-fix, the loop did
    //   if (output-only) continue;
    //   captureContextWindow();
    // — which meant tail output-only records with positive
    // context_window dropped that capacity on the floor.
    // Post-fix shape: the capture (latestSdkContextWindow assignment)
    // must appear textually BEFORE the skip predicate. We assert
    // ordering by index of the assignment vs. the skip predicate.
    const captureIdx = src.search(/latestSdkContextWindow\s*=\s*[^=]/); // `latestSdkContextWindow = …` (assignment, not comparison)
    const skipIdx = src.search(/used\s*===\s*0\s*&&\s*outputTokens\s*>\s*0[\s\S]{0,40}continue/);
    assert.ok(captureIdx >= 0, 'expected a `latestSdkContextWindow = …` assignment that captures the SDK-reported window');
    assert.ok(skipIdx >= 0, 'expected the output-only skip predicate');
    assert.ok(
      captureIdx < skipIdx,
      `walkContextUsage must capture latestSdkContextWindow BEFORE the output-only skip — captureIdx=${captureIdx}, skipIdx=${skipIdx}. The skipped record\'s context_window is what keeps GLM / Bailian / etc. out of "capacity unknown."`,
    );
  });

  it('only sets latestSdkContextWindow on the FIRST positive value (newest wins; older zero/missing must not overwrite)', () => {
    // Two requirements:
    //   • `latestSdkContextWindow === null` guard (newest wins)
    //   • `> 0` guard (stale zero must not capture)
    // Both must appear inside the same capture block. We loosen the
    // anchor to allow intermediate type checks (`typeof … === 'number'`).
    assert.match(
      src,
      /latestSdkContextWindow\s*===\s*null/,
      'walkContextUsage must guard the capture with `latestSdkContextWindow === null` so older records can\'t overwrite a captured value',
    );
    assert.match(
      src,
      /context_window[\s\S]{0,200}>\s*0|>\s*0[\s\S]{0,200}latestSdkContextWindow\s*=/,
      'walkContextUsage must require `context_window > 0` before capturing — a stale zero from a partial adapter must not blank out a captured value',
    );
  });
});

describe('useContextUsage — wiring contract', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'hooks/useContextUsage.ts'),
    'utf8',
  );

  it('imports walkContextUsage from the helper module', () => {
    assert.match(
      src,
      /import\s*\{\s*walkContextUsage\s*\}\s*from\s*['\"]@\/lib\/context-usage-walk['\"]/,
      'useContextUsage must consume walkContextUsage so the skip + capacity-capture rules stay in one place',
    );
  });

  it('resolves contextWindow with the documented 3-way priority chain', () => {
    // Anchor the exact `??` order. Reordering would silently change
    // semantics — e.g. `latestSdkContextWindow ?? sdkContextWindow`
    // would prefer a transient tail value over the baseline turn's
    // own window in multi-model sessions.
    assert.match(
      src,
      /sdkContextWindow\s*\?\?\s*latestSdkContextWindow\s*\?\?\s*catalogContextWindow/,
      'useContextUsage must resolve contextWindow as `sdkContextWindow ?? latestSdkContextWindow ?? catalogContextWindow`',
    );
  });

  it('falls back to latestSdkContextWindow even when no baseline exists', () => {
    // The "first turn was output-only" case: baseline is null but we
    // still want to surface the capacity number the SDK gave us.
    assert.match(
      src,
      /contextWindow:\s*latestSdkContextWindow\s*\?\?\s*catalogContextWindow/,
      'useContextUsage no-baseline branch must still surface latestSdkContextWindow ?? catalogContextWindow so the popover header can show "0 / capacity" instead of "容量未知"',
    );
  });
});
