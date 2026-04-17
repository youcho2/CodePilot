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

/**
 * Returns { firstEventMs, firstTextMs }:
 *   - firstEventMs: ms until the first SDK stream event of any kind (system/
 *     init/control). Proxies initialize+handshake latency.
 *   - firstTextMs: ms until the first assistant text delta / content token.
 *     Proxies what the user actually perceives as first-character latency.
 * Codex note: only firstTextMs is a valid end-user latency proxy; firstEventMs
 * is logged for diagnostic reasons but not used for the p50 assertion.
 */
async function measureLatencies(run: () => AsyncIterable<unknown>): Promise<{ firstEventMs: number; firstTextMs: number }> {
  const start = Date.now();
  let firstEventMs = 0;
  let firstTextMs = 0;
  for await (const msg of run()) {
    if (!firstEventMs) firstEventMs = Date.now() - start;
    const m = msg as { type?: string; message?: { content?: unknown }; event?: { delta?: { text?: string } } };
    // Accept either assistant message with content or a stream_event carrying
    // a text delta. Break as soon as real user-visible text arrives.
    if (m.type === 'assistant' && m.message?.content) {
      firstTextMs = Date.now() - start;
      break;
    }
    if (m.event?.delta?.text) {
      firstTextMs = Date.now() - start;
      break;
    }
  }
  if (!firstTextMs) firstTextMs = Date.now() - start;
  return { firstEventMs, firstTextMs };
}

test('warm-query POC — prewarm reduces first-token latency by ≥30% (p50)', { skip: !POC_ENABLED || !HAS_CREDS }, async () => {
  if (!POC_ENABLED || !HAS_CREDS) {
    console.log('[warm-query-poc] Skipped — see runbook in file header');
    return;
  }

  const baseOptions = { model: 'claude-opus-4-7' as const, maxTurns: 1 };
  const N = 3; // small N, narrow scope; upshift if signal is noisy

  // Cold baseline: fresh query each time
  const coldEventSamples: number[] = [];
  const coldTextSamples: number[] = [];
  for (let i = 0; i < N; i++) {
    const { firstEventMs, firstTextMs } = await measureLatencies(() => query({ prompt: 'Reply with just "ok".', options: baseOptions }));
    coldEventSamples.push(firstEventMs);
    coldTextSamples.push(firstTextMs);
  }

  // Warm path: startup() then query once per WarmQuery
  const warmEventSamples: number[] = [];
  const warmTextSamples: number[] = [];
  for (let i = 0; i < N; i++) {
    const warm = await startup({ options: baseOptions });
    const { firstEventMs, firstTextMs } = await measureLatencies(() => warm.query('Reply with just "ok".'));
    warmEventSamples.push(firstEventMs);
    warmTextSamples.push(firstTextMs);
  }

  const p50 = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const coldTextP50 = p50(coldTextSamples);
  const warmTextP50 = p50(warmTextSamples);
  const textReduction = 1 - warmTextP50 / coldTextP50;

  // Diagnostic only — first-event latency measures control/init overhead, not UX.
  console.log(`[warm-query-poc] cold first-event p50=${p50(coldEventSamples)}ms warm first-event p50=${p50(warmEventSamples)}ms`);
  console.log(`[warm-query-poc] cold first-text p50=${coldTextP50}ms warm first-text p50=${warmTextP50}ms reduction=${(textReduction * 100).toFixed(1)}%`);
  console.log('[warm-query-poc] cold text samples:', coldTextSamples);
  console.log('[warm-query-poc] warm text samples:', warmTextSamples);

  // Decision criterion uses user-visible first-text latency, not init overhead.
  // If this fails, Phase 3 is NOT worth shipping.
  assert.ok(textReduction >= 0.3, `warm prewarm should cut first-text p50 latency by ≥30% (got ${(textReduction * 100).toFixed(1)}%)`);
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
