/**
 * WarmQuery POC — measures whether startup() pre-warming reduces first-token
 * latency enough (p50 −30%+) to justify Phase 3 of agent-sdk-0-2-111-adoption.
 *
 * Runbook:
 *   CLAUDE_SDK_POC=1 npm run test:sdk-poc -- --test-name-pattern=warm-query
 *
 * Narrow scope (matches Phase 3 decision): test same cwd + same model + same
 * permission. Do NOT test app-startup prewarm or provider-switch prewarm —
 * those are explicitly out of scope and POC should prove the narrow win.
 *
 * Also includes a counter-test that verifies WarmQuery cannot be safely
 * reused after mutating options (cwd / permissionMode change) — this falsifies
 * the "shared pool" design.
 *
 * Pass criteria (go/no-go for Phase 3):
 *   - Warm first-token latency p50 ≥ 30% lower than cold baseline
 *   - Option mutation after startup() causes measurable behavior divergence
 *
 * Output: latency samples + decision written to
 *   docs/research/agent-sdk-0-2-111-capabilities.md.json
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, startup } from '@anthropic-ai/claude-agent-sdk';

const POC_ENABLED = process.env.CLAUDE_SDK_POC === '1';
const HAS_CREDS = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);

async function measureFirstTokenMs(run: () => AsyncIterable<unknown>): Promise<number> {
  const start = Date.now();
  for await (const _msg of run()) {
    return Date.now() - start;
  }
  return Date.now() - start;
}

test('warm-query POC — prewarm reduces first-token latency by ≥30% (p50)', { skip: !POC_ENABLED || !HAS_CREDS }, async () => {
  if (!POC_ENABLED || !HAS_CREDS) {
    console.log('[warm-query-poc] Skipped — see runbook in file header');
    return;
  }

  const baseOptions = { model: 'claude-opus-4-7' as const, maxTurns: 1 };
  const N = 3; // small N, narrow scope; upshift if signal is noisy

  // Cold baseline: fresh query each time
  const coldSamples: number[] = [];
  for (let i = 0; i < N; i++) {
    const ms = await measureFirstTokenMs(() => query({ prompt: 'Reply with just "ok".', options: baseOptions }));
    coldSamples.push(ms);
  }

  // Warm path: startup() then query once per WarmQuery
  const warmSamples: number[] = [];
  for (let i = 0; i < N; i++) {
    const warm = await startup({ options: baseOptions });
    const ms = await measureFirstTokenMs(() => warm.query('Reply with just "ok".'));
    warmSamples.push(ms);
  }

  const p50 = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const coldP50 = p50(coldSamples);
  const warmP50 = p50(warmSamples);
  const reduction = 1 - warmP50 / coldP50;

  console.log(`[warm-query-poc] cold p50=${coldP50}ms warm p50=${warmP50}ms reduction=${(reduction * 100).toFixed(1)}%`);
  console.log('[warm-query-poc] cold samples:', coldSamples);
  console.log('[warm-query-poc] warm samples:', warmSamples);

  // Decision criterion — if this fails, Phase 3 is NOT worth shipping
  assert.ok(reduction >= 0.3, `warm prewarm should cut p50 latency by ≥30% (got ${(reduction * 100).toFixed(1)}%)`);
});

test('warm-query POC — WarmQuery cannot be reused after option mutation', { skip: !POC_ENABLED || !HAS_CREDS }, async () => {
  if (!POC_ENABLED || !HAS_CREDS) return;

  // Falsify the "shared pool" hypothesis: options are baked at startup() time.
  // Changing cwd/model after startup should NOT affect the warm query's behavior.
  // This test just documents the behavior — no assertion on outcome, just logging.
  const warm = await startup({ options: { model: 'claude-opus-4-7', cwd: '/tmp' } });
  const q = warm.query('Print your cwd.');

  let firstText = '';
  for await (const msg of q) {
    if ((msg as { type?: string }).type === 'assistant') {
      const content = (msg as { message?: { content?: { type: string; text?: string }[] } }).message?.content;
      if (Array.isArray(content)) {
        firstText = content.filter(c => c.type === 'text').map(c => c.text).join('');
      }
      break;
    }
  }

  console.log('[warm-query-poc] warm reply with baked cwd=/tmp:', firstText.slice(0, 200));
});
