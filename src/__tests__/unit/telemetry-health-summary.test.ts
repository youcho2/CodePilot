import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { claimHealthSummary, healthSummaryBucket } from '../../lib/telemetry/health-summary';

describe('telemetry health summary budget', () => {
  it('deduplicates across process-like calls for 24 hours without storing raw input', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-health-'));
    const file = path.join(dir, 'health.json');
    const input = {
      release: 'codepilot@0.63.0',
      category: 'NO_CREDENTIALS',
      providerClass: 'configured',
      runtimeId: 'claude_code',
    };
    try {
      assert.equal(claimHealthSummary(file, input, 1_000), true);
      assert.equal(claimHealthSummary(file, input, 2_000), false);
      assert.equal(claimHealthSummary(file, input, 86_401_001), true);
      const stored = fs.readFileSync(file, 'utf8');
      assert.match(stored, /no_credentials/);
      assert.doesNotMatch(stored, /prompt|api[_-]?key|https?:/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bounds and normalizes every bucket component', () => {
    assert.equal(
      healthSummaryBucket({
        release: 'codepilot@0.63.0',
        category: 'AUTH_REJECTED',
        providerClass: 'https://private.example/path',
        runtimeId: 'session/secret',
      }),
      'codepilot@0.63.0|auth_rejected|other|other',
    );
  });
});
