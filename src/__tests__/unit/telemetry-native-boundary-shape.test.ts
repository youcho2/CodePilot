import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

function source(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

describe('native provider telemetry capture boundaries', () => {
  it('agent-loop defers onError capture to the retry-exhausted catch tail', () => {
    const code = source('../../lib/agent-loop.ts');
    const onErrorStart = code.indexOf('onError: (event) => {');
    const onErrorEnd = code.indexOf('\n            },', onErrorStart);
    assert.ok(onErrorStart >= 0 && onErrorEnd > onErrorStart);
    const onError = code.slice(onErrorStart, onErrorEnd);
    assert.match(onError, /lastProviderStreamError = err/);
    assert.match(onError, /markProviderFailureHandled\(err\)/);
    assert.doesNotMatch(onError, /reportNativeError\(/);
    assert.match(code, /const telemetryError = timedOut \? err : \(lastProviderStreamError \?\? err\)/);
    assert.match(code, /retryExhausted: true/);
  });

  it('ToolLoop POC uses the same deferred structured-error boundary', () => {
    const code = source('../../lib/experimental/agent-loop-toolloop-poc.ts');
    const caseStart = code.indexOf("case 'error': {");
    const caseEnd = code.indexOf('\n            }', caseStart);
    assert.ok(caseStart >= 0 && caseEnd > caseStart);
    const errorCase = code.slice(caseStart, caseEnd);
    assert.match(errorCase, /lastProviderStreamError = err/);
    assert.match(errorCase, /markProviderFailureHandled\(err\)/);
    assert.doesNotMatch(errorCase, /reportNativeError\(/);
    assert.match(code, /reportNativeError\('NATIVE_STREAM_ERROR', lastProviderStreamError \?\? err/);
    assert.match(code, /retryExhausted: true/);
  });

  it('shared provider boundary owns the marker before rethrow/auto-capture', () => {
    const generator = source('../../lib/text-generator.ts');
    const boundary = source('../../lib/telemetry/provider-failure.ts');
    const instrumentation = source('../../instrumentation.ts');
    assert.match(generator, /toMarkableProviderFailure\(error\)/);
    assert.match(generator, /reportProviderFailure\(markableError/);
    assert.doesNotMatch(generator, /markProviderFailureHandled/);
    assert.match(boundary, /markProviderFailureHandled\(error\)/);
    assert.match(
      instrumentation,
      /if \(isProviderFailureHandled\(hint\.originalException\)\) return null/,
    );
  });
});
