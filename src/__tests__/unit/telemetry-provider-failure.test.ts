import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { describeProviderFailure, providerFailureStatus, providerTelemetryIdentity } from '../../lib/telemetry/provider-failure';
import { isProviderFailureHandled, markProviderFailureHandled } from '../../lib/telemetry/provider-marker';

describe('provider failure telemetry boundary', () => {
  it('extracts status from SDK-compatible shapes without reading bodies', () => {
    assert.equal(providerFailureStatus({ statusCode: 502, responseBody: 'private prompt' }), 502);
    assert.equal(providerFailureStatus({ response: { status: 429, body: 'private' } }), 429);
    assert.equal(providerFailureStatus({ status: 'not-a-status' }), undefined);
  });

  it('keeps provider tests and user actions out of Error Issues', () => {
    assert.equal(
      describeProviderFailure({ statusCode: 500 }, 'connection_test').outcome,
      'provider_test_result',
    );
    assert.equal(
      describeProviderFailure({ statusCode: 401 }, 'automatic_title').outcome,
      'user_action_required',
    );
    assert.equal(
      describeProviderFailure(new Error('request cancelled'), 'automatic_title').outcome,
      'user_cancelled',
    );
  });

  it('marks every direct Provider Doctor classifyError call as a test result', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/claude-client.ts'), 'utf8');
    const section = source.slice(source.indexOf('export async function testProviderConnection'));
    const calls = [...section.matchAll(/classifyError\(\{[\s\S]*?\}\);/g)];
    assert.ok(calls.length >= 8, 'expected every protocol-specific connection-test error path');
    for (const call of calls) assert.match(call[0], /providerTest:\s*true/);
  });

  it('reports only retry-exhausted/transient or unowned failures', () => {
    assert.deepEqual(
      describeProviderFailure({ statusCode: 503 }, 'automatic_memory_extract'),
      {
        category: 'PROVIDER_UPSTREAM_UNAVAILABLE',
        outcome: 'transient_upstream',
        statusCode: 503,
        retryExhausted: true,
      },
    );
    assert.equal(
      describeProviderFailure({ statusCode: 422 }, 'structured_generation').outcome,
      'unknown',
    );
  });

  it('derives only stable protocol/class identity for native runtime events', () => {
    const identity = providerTelemetryIdentity({
      protocol: 'openai',
      provider: { preset_key: 'openrouter' },
    } as never);
    assert.deepEqual(identity, { providerProtocol: 'openai', providerClass: 'managed' });
    assert.deepEqual(
      providerTelemetryIdentity(undefined),
      { providerProtocol: 'unknown', providerClass: 'environment' },
    );
  });

  it('marks a rich user-facing error non-enumerably to prevent double capture', () => {
    const error = new Error('upstream body remains available to the UI');
    markProviderFailureHandled(error);
    assert.equal(isProviderFailureHandled(error), true);
    assert.deepEqual(Object.keys(error), []);
  });
});
