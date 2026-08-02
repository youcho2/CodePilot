const PROVIDER_TELEMETRY_HANDLED = Symbol.for('codepilot.telemetry.provider-handled');

type MarkedFailure = { [PROVIDER_TELEMETRY_HANDLED]?: true };

export function markProviderFailureHandled(error: unknown): void {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return;
  Object.defineProperty(error, PROVIDER_TELEMETRY_HANDLED, {
    value: true,
    enumerable: false,
    configurable: false,
  });
}

export function isProviderFailureHandled(error: unknown): boolean {
  return Boolean(
    error
      && (typeof error === 'object' || typeof error === 'function')
      && (error as MarkedFailure)[PROVIDER_TELEMETRY_HANDLED],
  );
}
