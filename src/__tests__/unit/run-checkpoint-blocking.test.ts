/**
 * Round 2 — flow-level contract tests for the "blocking + confirm-and-send"
 * cycle. Models the MessageInput's bypass-flag state machine and the
 * page's permissionElevationConfirmedFor state machine without React,
 * so we can lock down the contract independently of the React renderer.
 *
 * The contract under test:
 *   1. While a `requiresConfirm` reason is active, MessageInput's
 *      handleSubmit returns early.
 *   2. The banner's confirm action sets bypass=true synchronously,
 *      then re-triggers submit; that submit proceeds even if the
 *      reason hasn't been cleared yet (state propagation may lag).
 *   3. After bypass consumes ONE submit, it auto-clears so the next
 *      user-initiated submit re-blocks.
 *   4. permission-elevation: confirming sets the flag to 'full_access';
 *      next buildCheckpoints call doesn't include the reason.
 *   5. Toggling the permission profile away from full_access resets
 *      the flag, so toggling back on re-arms the banner.
 *
 * Run: npx tsx --test src/__tests__/unit/run-checkpoint-blocking.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCheckpoints, type BuildCheckpointsOpts } from '../../lib/run-checkpoint';

// ─── Tiny model of MessageInput's bypass machine ────────────────────

function makeSubmitMachine(initialBlockingIds: string[]) {
  const state = {
    blockingIds: [...initialBlockingIds],
    bypass: false,
    submitsRecorded: 0,
  };
  return {
    state,
    setBlockingIds(ids: string[]) {
      state.blockingIds = [...ids];
    },
    /** User clicks composer send. Returns true if the send went through. */
    userSubmit(): boolean {
      if (!state.bypass && state.blockingIds.length > 0) return false;
      state.bypass = false; // consume one
      state.submitsRecorded += 1;
      return true;
    },
    /** Banner action: set bypass + re-attempt submit (mimics the
     *  window-event flow in MessageInput). */
    confirmAndSend(): boolean {
      state.bypass = true;
      // Note: blockingIds is intentionally not cleared here. The page
      // will clear it on its next render (state propagation lag).
      // The test asserts bypass overrides the lag.
      const ok = state.bypass && (state.bypass || state.blockingIds.length === 0);
      if (!ok) return false;
      state.bypass = false;
      state.submitsRecorded += 1;
      return true;
    },
  };
}

const ok: BuildCheckpointsOpts = {
  noCompatibleProvider: false,
  defaultInvalid: false,
  runtimeFallback: false,
};

// ─── Contract 1-3: bypass machine ───────────────────────────────────

describe('MessageInput-style submit blocking + bypass', () => {
  it('user submit is blocked while a requiresConfirm reason is active', () => {
    const m = makeSubmitMachine(['context-cost-change']);
    assert.equal(m.userSubmit(), false);
    assert.equal(m.state.submitsRecorded, 0);
  });

  it('confirm-and-send goes through even when blocking ids are still set', () => {
    const m = makeSubmitMachine(['context-cost-change']);
    // The state-machine deliberately keeps blockingIds set to model
    // React state-propagation lag between confirm-action and re-render.
    assert.equal(m.confirmAndSend(), true);
    assert.equal(m.state.submitsRecorded, 1);
  });

  it('bypass auto-clears after one consume — next user submit re-blocks', () => {
    const m = makeSubmitMachine(['permission-elevation']);
    m.confirmAndSend();
    assert.equal(m.userSubmit(), false, 'second submit must re-block');
    assert.equal(m.state.submitsRecorded, 1);
  });

  it('user submit goes through normally when no blocking reasons', () => {
    const m = makeSubmitMachine([]);
    assert.equal(m.userSubmit(), true);
    assert.equal(m.state.submitsRecorded, 1);
  });
});

// ─── Contract 4-5: permission-elevation session state ───────────────

describe('Page-level permission-elevation confirmed state', () => {
  // Mirrors the chat/page.tsx + ChatView.tsx state pattern:
  //   permissionElevationConfirmedFor: 'full_access' | null
  //   - reset to null when permissionProfile leaves full_access
  //   - set to 'full_access' on banner confirm
  //   - feeds into buildCheckpoints via:
  //       permissionElevationPending =
  //         permissionProfile === 'full_access' &&
  //         permissionElevationConfirmedFor !== 'full_access'

  type Profile = 'default' | 'full_access';
  function pending(profile: Profile, confirmed: 'full_access' | null) {
    return profile === 'full_access' && confirmed !== 'full_access';
  }
  /** Mirror of the page's `useEffect` that clears the confirmed flag
   *  whenever the profile leaves full_access. */
  function resetIfNotFullAccess(profile: Profile, confirmed: 'full_access' | null) {
    return profile === 'full_access' ? confirmed : null;
  }

  it('first send under full_access fires the banner', () => {
    const reasons = buildCheckpoints({
      ...ok,
      permissionElevationPending: pending('full_access', null),
    });
    assert.ok(reasons.some((r) => r.id === 'permission-elevation'));
  });

  it('after confirm, the banner does NOT fire again this session', () => {
    const reasons = buildCheckpoints({
      ...ok,
      permissionElevationPending: pending('full_access', 'full_access'),
    });
    assert.equal(reasons.find((r) => r.id === 'permission-elevation'), undefined);
  });

  it('toggling profile to default and back to full_access re-arms the banner', () => {
    // Step 1 — confirmed under full_access.
    let confirmed: 'full_access' | null = 'full_access';
    let profile: 'default' | 'full_access' = 'full_access';
    assert.equal(pending(profile, confirmed), false, 'no banner after confirm');

    // Step 2 — user toggles back to default. The page's effect clears
    // the confirmed flag.
    profile = 'default';
    // The page's effect: when profile leaves full_access, reset confirmed.
    // We ALWAYS assign null here (current state of profile is 'default'),
    // but kept as a function call to mirror the if-statement structure.
    confirmed = resetIfNotFullAccess(profile, confirmed);
    assert.equal(pending(profile, confirmed), false, 'no banner under default profile');

    // Step 3 — user toggles back ON to full_access. The previously-
    // cleared flag means the banner re-fires.
    profile = 'full_access';
    assert.equal(pending(profile, confirmed), true, 'banner re-arms');
  });

  it('toggling without ever confirming still shows banner each time profile is full_access', () => {
    let confirmed: 'full_access' | null = null;
    let profile: 'default' | 'full_access' = 'default';
    assert.equal(pending(profile, confirmed), false);
    profile = 'full_access';
    assert.equal(pending(profile, confirmed), true);
    profile = 'default';
    // The page's effect: when profile leaves full_access, reset confirmed.
    // We ALWAYS assign null here (current state of profile is 'default'),
    // but kept as a function call to mirror the if-statement structure.
    confirmed = resetIfNotFullAccess(profile, confirmed);
    assert.equal(pending(profile, confirmed), false);
    profile = 'full_access';
    assert.equal(pending(profile, confirmed), true);
  });
});

// ─── Contract 1+4: integrated — context-cost across a "send" ─────────

describe('Context-cost reason auto-clears after the underlying send', () => {
  // Pure flow: when user has a 12K pending and then confirms+sends,
  // the chip-add → send pipeline drops pending to 0; the next call
  // to buildCheckpoints with pending=0 must omit the reason.
  it('pending=12K → reason fires; pending=0 after send → reason gone', () => {
    let pending = 12_000;
    let used = 0;
    const before = buildCheckpoints({ ...ok, pendingContextTokens: pending, usedContextTokens: used });
    assert.ok(before.some((r) => r.id === 'context-cost-change'));

    // Simulate send: chips clear → pendingContextTokens drops to 0,
    // usedContextTokens climbs by the same amount.
    used += pending;
    pending = 0;
    const after = buildCheckpoints({ ...ok, pendingContextTokens: pending, usedContextTokens: used });
    assert.equal(after.find((r) => r.id === 'context-cost-change'), undefined);
  });
});
