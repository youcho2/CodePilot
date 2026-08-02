import type { ProviderCallScene } from '../provider-call-policy';
import type { ResolvedProvider } from '../provider-resolver';
import {
  buildNormalizedFingerprint,
  statusClass,
  type TelemetryOutcomeKind,
} from './contract';

type UnknownRecord = Record<string, unknown>;

export interface ProviderFailureDescription {
  category: string;
  outcome: TelemetryOutcomeKind;
  statusCode?: number;
  retryExhausted: boolean;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' ? value as UnknownRecord : undefined;
}

export function providerFailureStatus(error: unknown): number | undefined {
  const record = asRecord(error);
  const response = asRecord(record?.response);
  const candidate = record?.statusCode ?? record?.status ?? response?.status;
  const value = typeof candidate === 'number' ? candidate : Number(candidate);
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

export function describeProviderFailure(
  error: unknown,
  callScene: ProviderCallScene,
): ProviderFailureDescription {
  if (callScene === 'connection_test') {
    return { category: 'PROVIDER_TEST_FAILED', outcome: 'provider_test_result', retryExhausted: false };
  }
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = providerFailureStatus(error);
  if (/abort|cancel/i.test(message) && !/timeout|timed out/i.test(message)) {
    return { category: 'PROVIDER_CANCELLED', outcome: 'user_cancelled', statusCode, retryExhausted: false };
  }
  if (/timeout|timed out/i.test(message)) {
    return { category: 'PROVIDER_TIMEOUT', outcome: 'transient_upstream', statusCode, retryExhausted: true };
  }
  if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
    return { category: 'PROVIDER_ACCESS_REQUIRED', outcome: 'user_action_required', statusCode, retryExhausted: false };
  }
  if (statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
    return { category: 'PROVIDER_UPSTREAM_UNAVAILABLE', outcome: 'transient_upstream', statusCode, retryExhausted: true };
  }
  if (statusCode === 400 || statusCode === 422) {
    return { category: 'PROVIDER_REQUEST_REJECTED', outcome: 'unknown', statusCode, retryExhausted: false };
  }
  return { category: 'PROVIDER_FAILURE', outcome: 'unknown', statusCode, retryExhausted: false };
}

export interface ProviderTelemetryIdentity {
  providerProtocol: string;
  providerClass: string;
}

export function providerTelemetryIdentity(resolved?: ResolvedProvider): ProviderTelemetryIdentity {
  const providerClass = !resolved?.provider
    ? 'environment'
    : resolved.provider.preset_key
      ? 'managed'
      : 'configured';
  return {
    providerProtocol: resolved?.protocol || 'unknown',
    providerClass,
  };
}

function providerClass(resolved?: ResolvedProvider): string {
  return providerTelemetryIdentity(resolved).providerClass;
}

/** Capture once at the common provider boundary without prompt/result/body. */
export function reportProviderFailure(
  error: unknown,
  input: { callScene: ProviderCallScene; resolvedProvider?: ResolvedProvider },
): void {
  if (process.env.NODE_ENV !== 'development') {
    if (
      process.env.NODE_ENV !== 'production'
      || process.env.NEXT_PUBLIC_CODEPILOT_CHANNEL !== 'stable'
    ) return;

    const description = describeProviderFailure(error, input.callScene);
    if (
      description.outcome === 'provider_test_result'
      || description.outcome === 'user_cancelled'
      || description.outcome === 'user_action_required'
    ) return;

    import('@sentry/node').then((Sentry) => {
      if (!Sentry.isInitialized()) return;
      const protocol = input.resolvedProvider?.protocol || 'unknown';
      const classification = providerClass(input.resolvedProvider);
      Sentry.withScope((scope) => {
        scope.setTag('error.category', description.category);
        scope.setTag('error.outcome', description.outcome);
        scope.setTag('error.runtime', 'codepilot_runtime');
        scope.setTag('runtime.id', 'codepilot_runtime');
        scope.setTag('provider.protocol', protocol);
        scope.setTag('provider.class', classification);
        scope.setTag('status.class', statusClass(description.statusCode));
        scope.setTag('grouping.strategy', 'normalized');
        scope.setExtras({
          callScene: input.callScene,
          retryExhausted: description.retryExhausted,
        });
        scope.setFingerprint(buildNormalizedFingerprint({
          category: description.category,
          layer: 'next_server',
          runtimeId: 'codepilot_runtime',
          providerProtocol: protocol,
          providerClass: classification,
          statusCode: description.statusCode,
        }));
        Sentry.captureMessage('provider.request_failed', 'error');
      });
    }).catch(() => { /* telemetry cannot affect provider behavior */ });
  }
}
