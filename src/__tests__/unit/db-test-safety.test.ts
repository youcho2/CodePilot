import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  isDefaultCodePilotDataDir,
  isTestRunnerProcess,
  shouldRefuseRealDbFromTest,
} from '../../lib/db-test-safety';

const HOME_DIR = path.join(path.sep, 'Users', 'test-user');
const REAL_DATA_DIR = path.join(HOME_DIR, '.codepilot');

describe('DB test safety policy', () => {
  it('treats an unset or explicitly configured ~/.codepilot path as the real DB', () => {
    assert.equal(isDefaultCodePilotDataDir(undefined, HOME_DIR), true);
    assert.equal(isDefaultCodePilotDataDir(REAL_DATA_DIR, HOME_DIR), true);
    assert.equal(
      isDefaultCodePilotDataDir(path.join(REAL_DATA_DIR, '..', '.codepilot'), HOME_DIR),
      true,
    );
  });

  it('preserves a genuinely isolated test data directory', () => {
    assert.equal(
      isDefaultCodePilotDataDir(path.join(path.sep, 'tmp', 'codepilot-unit-db-123'), HOME_DIR),
      false,
    );
  });

  it('detects node:test from argv, execArgv, or test-runner environment flags', () => {
    assert.equal(isTestRunnerProcess({ env: {}, argv: ['node', '--test'], execArgv: [] }), true);
    assert.equal(
      isTestRunnerProcess({ env: {}, argv: ['node'], execArgv: ['src/unit/example.test.ts'] }),
      true,
    );
    assert.equal(
      isTestRunnerProcess({ env: { NODE_ENV: 'test' }, argv: ['node'], execArgv: [] }),
      true,
    );
    assert.equal(isTestRunnerProcess({ env: {}, argv: ['node', 'server.js'], execArgv: [] }), false);
  });

  it('refuses only the real DB under a test runner', () => {
    const testProcess = { env: {}, argv: ['node', '--test'], execArgv: [] };
    assert.equal(shouldRefuseRealDbFromTest(REAL_DATA_DIR, HOME_DIR, testProcess), true);
    assert.equal(
      shouldRefuseRealDbFromTest('/tmp/codepilot-unit-db-123', HOME_DIR, testProcess),
      false,
    );
    assert.equal(
      shouldRefuseRealDbFromTest(REAL_DATA_DIR, HOME_DIR, {
        env: {},
        argv: ['node', 'server.js'],
        execArgv: [],
      }),
      false,
    );
  });
});
