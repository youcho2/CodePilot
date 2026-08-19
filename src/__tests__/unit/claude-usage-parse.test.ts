/**
 * Contract test for parseClaudeUsage() — the pure narrowing of the internal
 * /api/oauth/usage payload into ClaudeUsageSnapshot.
 *
 * Guards 反假数据 invariants confirmed against a live max-plan response
 * (2026-08-19): `limits[].percent` is 0–100 (not a 0..1 fraction),
 * `resets_at` passes through as an ISO string (not epoch), weekly_scoped
 * carries its model display name, and empty/garbage input yields zero
 * windows (so the route can render an honest empty state, never a fake 0).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeUsage } from '../../lib/claude-usage';

const NOW = 1_755_600_000_000;

// Trimmed real response (fields we consume).
const LIVE = {
  five_hour: { utilization: 6.0, resets_at: '2026-08-19T08:20:00.160621+00:00' },
  seven_day: { utilization: 8.0, resets_at: '2026-08-20T18:00:00.160645+00:00' },
  limits: [
    { kind: 'session', group: 'session', percent: 6, severity: 'normal', resets_at: '2026-08-19T08:20:00Z', scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: 8, severity: 'normal', resets_at: '2026-08-20T18:00:00Z', scope: null, is_active: true },
    { kind: 'weekly_scoped', group: 'weekly', percent: 5, severity: 'normal', resets_at: '2026-08-20T18:00:00Z', scope: { model: { display_name: 'Opus' } }, is_active: false },
  ],
};

describe('parseClaudeUsage', () => {
  it('maps limits[] into ordered windows with 0-100 percent and ISO reset', () => {
    const snap = parseClaudeUsage(LIVE, 'max', NOW);
    assert.equal(snap.subscriptionType, 'max');
    assert.equal(snap.capturedAt, NOW);
    assert.equal(snap.windows.length, 3);

    const [session, weekly, scoped] = snap.windows;
    assert.equal(session.kind, 'session');
    assert.equal(session.usedPercent, 6);
    assert.equal(session.resetsAt, '2026-08-19T08:20:00Z');

    assert.equal(weekly.kind, 'weekly_all');
    assert.equal(weekly.usedPercent, 8);
    assert.equal(weekly.isActive, true);

    assert.equal(scoped.kind, 'weekly_scoped');
    assert.equal(scoped.usedPercent, 5);
    assert.equal(scoped.scopeModel, 'Opus'); // model display name flows through
  });

  it('clamps out-of-range percents into 0..100', () => {
    const snap = parseClaudeUsage(
      { limits: [{ kind: 'session', percent: 140 }, { kind: 'weekly_all', percent: -3 }] },
      undefined,
      NOW,
    );
    assert.equal(snap.windows[0].usedPercent, 100);
    assert.equal(snap.windows[1].usedPercent, 0);
  });

  it('falls back to top-level five_hour/seven_day when limits[] is absent', () => {
    const snap = parseClaudeUsage(
      {
        five_hour: { utilization: 12, resets_at: '2026-08-19T08:20:00Z' },
        seven_day: { utilization: 30, resets_at: '2026-08-20T18:00:00Z' },
      },
      'pro',
      NOW,
    );
    assert.equal(snap.windows.length, 2);
    assert.equal(snap.windows[0].kind, 'session');
    assert.equal(snap.windows[0].usedPercent, 12);
    assert.equal(snap.windows[1].kind, 'weekly_all');
    assert.equal(snap.windows[1].usedPercent, 30);
  });

  it('yields zero windows for empty/garbage input (honest empty state, no fake 0)', () => {
    assert.equal(parseClaudeUsage({}, undefined, NOW).windows.length, 0);
    assert.equal(parseClaudeUsage(null, undefined, NOW).windows.length, 0);
    assert.equal(parseClaudeUsage({ limits: 'nope' }, undefined, NOW).windows.length, 0);
    assert.equal(parseClaudeUsage({ limits: [{ kind: 'session' }] }, undefined, NOW).windows.length, 0); // no percent
  });
});
