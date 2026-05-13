/**
 * Phase 5 Phase 4 Slice 2 — Codex approval bridge.
 *
 * Pins the PermissionResult → Codex response-shape mapping. The
 * mapping has FOUR axes:
 *
 *   - allow vs deny (behavior)
 *   - session-scope flag (updatedPermissions populated)
 *   - canonical method (item/commandExecution/... → 'accept'/'decline')
 *     vs legacy (execCommandApproval / applyPatchApproval →
 *     'approved'/'denied')
 *
 * The schema files in `资料/codex/.../v2/` defining these unions:
 *   CommandExecutionApprovalDecision = 'accept' | 'acceptForSession' |
 *                                       'decline' | 'cancel' | ...amendments
 *   FileChangeApprovalDecision = 'accept' | 'acceptForSession' |
 *                                 'decline' | 'cancel'
 *   ReviewDecision (legacy) = 'approved' | 'approved_for_session' |
 *                              'denied' | 'timed_out' | 'abort' | ...
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resultToCodexResponse,
  makeCodexPermissionRequestId,
} from '@/lib/codex/approval-bridge';

const allow = { behavior: 'allow' as const };
const allowSession = {
  behavior: 'allow' as const,
  updatedPermissions: [{ type: 'addRule' }] as unknown[],
};
const deny = { behavior: 'deny' as const, message: 'user denied' };

describe('resultToCodexResponse — canonical methods (accept/decline)', () => {
  for (const method of [
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
  ]) {
    it(`${method}: allow → { decision: 'accept' }`, () => {
      assert.deepEqual(resultToCodexResponse(allow, method), { decision: 'accept' });
    });
    it(`${method}: allow + session scope → { decision: 'acceptForSession' }`, () => {
      assert.deepEqual(resultToCodexResponse(allowSession, method), {
        decision: 'acceptForSession',
      });
    });
    it(`${method}: deny → { decision: 'decline' }`, () => {
      assert.deepEqual(resultToCodexResponse(deny, method), { decision: 'decline' });
    });
  }
});

describe('resultToCodexResponse — legacy methods (approved/denied)', () => {
  for (const method of ['execCommandApproval', 'applyPatchApproval']) {
    it(`${method}: allow → { decision: 'approved' } (legacy verb)`, () => {
      assert.deepEqual(resultToCodexResponse(allow, method), { decision: 'approved' });
    });
    it(`${method}: allow + session scope → { decision: 'approved_for_session' }`, () => {
      assert.deepEqual(resultToCodexResponse(allowSession, method), {
        decision: 'approved_for_session',
      });
    });
    it(`${method}: deny → { decision: 'denied' }`, () => {
      assert.deepEqual(resultToCodexResponse(deny, method), { decision: 'denied' });
    });
  }
});

describe('makeCodexPermissionRequestId — stable prefix', () => {
  it('prepends "codex:" to the JSON-RPC id', () => {
    assert.equal(makeCodexPermissionRequestId(42), 'codex:42');
    assert.equal(makeCodexPermissionRequestId('abc'), 'codex:abc');
  });

  it('lets log scrapers and tests distinguish Codex requests at a glance', () => {
    const id = makeCodexPermissionRequestId(123);
    assert.ok(id.startsWith('codex:'));
  });
});
