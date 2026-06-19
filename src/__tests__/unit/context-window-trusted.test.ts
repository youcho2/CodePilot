/**
 * context-window-trusted.test.ts — guardrail for v0.56.x Phase 2 (#632):
 * the context-usage UI must only show a percentage / remaining / unused
 * against a TRUSTED (SDK / upstream-reported) context window. The static
 * `catalogContextWindow` fallback is a guess; rendering a percentage over it
 * is what produced the ">100%" / 假百分比 the user reported.
 *
 * Contract (source-pinned because the hook + RunCockpit need React and the
 * repo has no component test harness — same approach as
 * `use-context-usage-output-only-skip.test.ts` and
 * `run-cockpit-unknown-capacity.test.ts`):
 *
 *   1. useContextUsage derives `contextWindowTrusted` from SDK-window
 *      presence (sdkContextWindow / latestSdkContextWindow), NOT catalog.
 *   2. useContextUsage omits the window it feeds the breakdown when untrusted
 *      (so the dot-matrix shows used-relative composition, not a fake total).
 *   3. RunCockpit gates `hasFullCtx` on `usage.contextWindowTrusted`.
 *   4. Both render sites clamp the displayed ratio to ≤100%.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.join(__dirname, '..', '..');
const hookSrc = fs.readFileSync(path.join(repoRoot, 'hooks/useContextUsage.ts'), 'utf8');
const cockpitSrc = fs.readFileSync(path.join(repoRoot, 'components/chat/RunCockpit.tsx'), 'utf8');
const popoverSrc = fs.readFileSync(path.join(repoRoot, 'components/chat/RunCockpitPopoverContent.tsx'), 'utf8');

describe('context-window trusted denominator (#632)', () => {
  it('ContextUsageData exposes a contextWindowTrusted: boolean field', () => {
    assert.match(
      hookSrc,
      /interface ContextUsageData\b[\s\S]*?contextWindowTrusted:\s*boolean/,
      'ContextUsageData must declare contextWindowTrusted so consumers can gate the percentage display',
    );
  });

  it('the baseline branch derives trusted from SDK window presence, not catalog', () => {
    assert.match(
      hookSrc,
      /const contextWindowTrusted = sdkContextWindow != null \|\| latestSdkContextWindow != null;/,
      'trusted must be SDK-sourced (sdkContextWindow / latestSdkContextWindow); the catalog fallback must NOT make it true',
    );
  });

  it('the breakdown window is omitted when untrusted (no fabricated capacity)', () => {
    assert.match(
      hookSrc,
      /contextWindow:\s*contextWindowTrusted\s*\?\s*\(contextWindow \?\? undefined\)\s*:\s*undefined/,
      'untrusted → pass undefined to buildContextUsageBreakdown so the dot-matrix renders a used-relative composition, not a guess-based %',
    );
  });

  it('RunCockpit gates hasFullCtx (the percentage path) on contextWindowTrusted', () => {
    assert.match(
      cockpitSrc,
      /const hasFullCtx = usage\.hasData && usage\.contextWindowTrusted && \(usage\.contextWindow \?\? 0\) > 0;/,
      'hasFullCtx must require a trusted window so a catalog fallback falls through to the absolute used-tokens display',
    );
  });

  it('RunCockpit clamps the displayed percentage to ≤100%', () => {
    assert.match(
      cockpitSrc,
      /const clampedRatio = Math\.min\(1, Math\.max\(0, usage\.ratio\)\);[\s\S]{0,200}clampedRatio \* 100/,
      'a trusted window momentarily exceeded by used (post-compaction) must never render >100%',
    );
  });

  it('RunCockpitPopoverContent clamps the header percentage to ≤100%', () => {
    assert.match(
      popoverSrc,
      /const clampedRatio = Math\.min\(1, Math\.max\(0, usage\.ratio\)\);[\s\S]{0,200}clampedRatio \* 100/,
      'popover header percentage must also clamp ≤100%',
    );
  });
});
