import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCodexSandboxReadiness,
  observeCodexSandboxNotification,
  resetCodexSandboxReadinessForTests,
} from '../../lib/codex/sandbox-readiness';

test('sandbox readiness starts unknown and never derives from app-server readiness', () => {
  resetCodexSandboxReadinessForTests();
  assert.deepEqual(getCodexSandboxReadiness(), {
    state: 'unknown',
    probe: 'not_run',
    source: 'not_observed',
  });
});

test('non-Windows hosts ignore Windows sandbox notifications', () => {
  resetCodexSandboxReadinessForTests();
  observeCodexSandboxNotification('windowsSandbox/setupCompleted', { success: true });
  if (process.platform !== 'win32') {
    assert.equal(getCodexSandboxReadiness().state, 'unknown');
  }
});

test('source pins keep setupCompleted observation wired without treating it as full ready', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../../lib/codex/sandbox-readiness.ts', import.meta.url), 'utf8');
  assert.match(source, /windowsSandbox\/setupCompleted/);
  assert.match(source, /state:\s*'setup'/);
  assert.doesNotMatch(source, /windowsSandbox\/setupCompleted'[\s\S]{0,800}state:\s*'ready'/);
});
