/**
 * Codex turn/interrupt contract — source-level pins.
 *
 * `turn/interrupt` in Codex requires `{ threadId, turnId }` per
 * `资料/codex/.../v2/TurnInterruptParams.ts`. Slice 3 (Phase 5 Phase 4)
 * captures the turnId returned by `turn/start` into an in-process map so
 * interrupt can find it.
 *
 * codex-stop-recovery (Phase 1/2) refactored the interrupt implementation
 * into a shared module-level helper `issueCodexTurnInterrupt(sessionId)` so
 * BOTH interrupt paths converge on one implementation:
 *   - the public `interrupt(sessionId)` method — HTTP `/api/chat/interrupt`
 *     fan-out (Stop button);
 *   - the in-stream abort-signal handler — honors the `abortController` the
 *     chat route already passes (force-abort / disconnect path).
 *
 * Source-level pins (not runtime-executed) because the full path needs a live
 * Codex app-server. They assert the structural contract is in place and, just
 * as importantly, that a future edit can't silently regress the Stop→interrupt
 * wiring (which previously left a Stopped Codex turn running forever).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const runtimeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/runtime.ts'),
  'utf8',
);

describe('Codex turn registry — Slice 3 contract', () => {
  it('activeCodexTurns map declared at module scope', () => {
    assert.match(
      runtimeSrc,
      /const\s+activeCodexTurns\s*=\s*new\s+Map<\s*string,\s*\{[\s\S]{0,200}threadId:\s*string[\s\S]{0,200}turnId:\s*string/,
    );
  });

  it('turn/start response → activeCodexTurns.set with (threadId, turnId)', () => {
    // Anchored on the real JSON-RPC call (not the word "turn/start", which now
    // also appears in Phase 2 comments) so the pin stays precise.
    assert.match(
      runtimeSrc,
      /client\.request<[^>]*>\('turn\/start'[\s\S]{0,800}activeCodexTurns\.set\(sessionId,\s*\{\s*threadId,\s*turnId:\s*turnResult\.turn\.id\s*\}\)/,
    );
  });

  it('closeStream() drops the active-turn entry on EVERY close path (codebase-health A4)', () => {
    // The delete moved OUT of the terminal-event branch and INTO closeStream,
    // positioned BEFORE the `active` guard, so an error/abort close that lands
    // before a terminal run_completed/run_failed event still can't leave a
    // stale turnId. This is the "no stale entries" invariant, now enforced at
    // the single close exit instead of only the happy terminal path.
    assert.match(
      runtimeSrc,
      /const closeStream = \(extra[^)]*\) => \{[\s\S]{0,1400}?activeCodexTurns\.delete\(sessionId\);[\s\S]{0,120}?if \(!active\) return;/,
    );
  });

  it('terminal run_completed | run_failed routes cleanup through closeStream() (no inline delete)', () => {
    // Terminal event must call closeStream() (which owns the cleanup); it must
    // NOT carry its own activeCodexTurns.delete anymore — that would re-fork
    // the cleanup the way A4 just consolidated.
    const terminalBranch = runtimeSrc.match(
      /event\?\.type\s*===\s*'run_completed'\s*\|\|\s*event\?\.type\s*===\s*'run_failed'\)\s*\{[\s\S]{0,500}?\n\s*\}/,
    );
    assert.ok(terminalBranch, 'expected the terminal-event branch in runtime.ts');
    assert.match(terminalBranch![0], /closeStream\(\);/);
    assert.doesNotMatch(
      terminalBranch![0],
      /activeCodexTurns\.delete/,
      'terminal branch should delegate cleanup to closeStream, not delete inline (A4 single-exit)',
    );
  });

  it('error catch path closes via closeStream so a throw after turn/start cleans up the entry', () => {
    // turn registered (activeCodexTurns.set) → throw before a terminal event →
    // catch → closeStream({ error }) → entry deleted. This is the exact
    // residual A4 set out to close.
    assert.match(
      runtimeSrc,
      /\}\s*catch\s*\(err\)\s*\{[\s\S]{0,200}closeStream\(\{\s*error:\s*reason\s*\}\)/,
    );
  });
});

describe('Codex interrupt — shared helper (single implementation)', () => {
  it('issueCodexTurnInterrupt reads activeCodexTurns and issues turn/interrupt with both ids', () => {
    assert.match(
      runtimeSrc,
      /function issueCodexTurnInterrupt\(sessionId: string, source: string\): boolean[\s\S]{0,400}activeCodexTurns\.get\(sessionId\)/,
    );
    assert.match(
      runtimeSrc,
      /function issueCodexTurnInterrupt[\s\S]{0,900}turn\/interrupt[\s\S]{0,300}threadId:\s*active\.threadId[\s\S]{0,300}turnId:\s*active\.turnId/,
    );
  });

  it('issueCodexTurnInterrupt short-circuits (returns false) when no active turn', () => {
    // Race-against-completion / abort-before-turnId: missing entry → no
    // JSON-RPC call, and a false return so the caller can defer.
    assert.match(
      runtimeSrc,
      /function issueCodexTurnInterrupt[\s\S]{0,300}if\s*\(!active\)\s*\{[\s\S]{0,200}return false/,
    );
  });

  it('public interrupt(sessionId) delegates to the shared helper (no duplicated impl)', () => {
    assert.match(
      runtimeSrc,
      /interrupt\(sessionId: string\): void \{[\s\S]{0,800}issueCodexTurnInterrupt\(sessionId, 'route'\)/,
    );
  });
});

describe('Codex stream() honors the abort signal (codex-stop-recovery Phase 2)', () => {
  it('reads options.abortController.signal and bails before turn/start if already aborted', () => {
    assert.match(
      runtimeSrc,
      /const abortSignal = options\.abortController\?\.signal;[\s\S]{0,300}if\s*\(abortSignal\?\.aborted\)\s*\{[\s\S]{0,200}closeStream\(\);[\s\S]{0,60}return/,
    );
  });

  it('an abort during the turn interrupts via the shared helper', () => {
    assert.match(
      runtimeSrc,
      /onAbort = \(\) => \{[\s\S]{0,200}issueCodexTurnInterrupt\(sessionId, 'abort-signal'\)/,
    );
    assert.match(
      runtimeSrc,
      /abortSignal\.addEventListener\('abort',\s*onAbort/,
    );
  });

  it('abort-before-turnId race re-interrupts the moment the turnId is recorded', () => {
    assert.match(
      runtimeSrc,
      /activeCodexTurns\.set\(sessionId[\s\S]{0,300}if\s*\(pendingAbort\)\s*\{[\s\S]{0,200}issueCodexTurnInterrupt\(sessionId, 'abort-race'\)/,
    );
  });
});
