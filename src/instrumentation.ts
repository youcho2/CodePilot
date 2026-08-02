/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize runtime log capture for the Doctor export feature.
 *
 * Sentry server-side init is gated behind a non-development guard. The
 * `@sentry/node` package eagerly registers a chain of `@opentelemetry/*`
 * instrumentations (HTTP, fs, dns, undici, …) on import — under
 * `next dev` with Turbopack this graph is one of the heaviest single
 * contributors to the dev-server RSS floor, and we don't ship dev-only
 * crashes anywhere. Production / packaged builds keep the original
 * behavior: read `NEXT_PUBLIC_SENTRY_DSN`, honor the
 * `~/.codepilot/sentry-disabled` opt-out marker, and call `Sentry.init`.
 *
 * `initRuntimeLog()` and `ensureSchedulerRunning()` deliberately stay
 * OUTSIDE the dev-guard — runtime-log capture and persisted task
 * scheduling have to work in `next dev` too.
 *
 * Locked in by `src/__tests__/unit/instrumentation-shape.test.ts`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NODE_ENV !== 'development') {
      // Initialize Sentry for server-side error capture (respects opt-out marker file)
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const { configureNextServerIntegrations, resolveTelemetryConfig, TELEMETRY_IGNORE_ERRORS } = await import('@/lib/telemetry/contract');
      const { isProviderFailureHandled } = await import('@/lib/telemetry/provider-marker');
      const { sanitizeTelemetryBreadcrumb, sanitizeTelemetryEvent } = await import('@/lib/telemetry/sanitize');
      const markerPath = path.join(os.homedir(), '.codepilot', 'sentry-disabled');
      const optedOut = fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf-8').trim() === 'true';
      const config = resolveTelemetryConfig({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        channel: process.env.NEXT_PUBLIC_CODEPILOT_CHANNEL,
        version: process.env.NEXT_PUBLIC_APP_VERSION,
        nodeEnv: process.env.NODE_ENV,
        optedOut,
      });
      if (config.enabled) {
        const Sentry = await import('@sentry/node');
        const { createTelemetrySmokeError, telemetrySmokeEnabled } = await import('@/lib/telemetry/smoke');
        Sentry.init({
          dsn: config.dsn,
          environment: config.environment,
          release: config.release,
          sendDefaultPii: false,
          tracesSampleRate: 0,
          ignoreErrors: TELEMETRY_IGNORE_ERRORS,
          integrations: (defaults) => configureNextServerIntegrations(
            defaults,
            Sentry.httpIntegration({
              trackIncomingRequestsAsSessions: false,
              maxIncomingRequestBodySize: 'none',
            }),
          ),
          beforeBreadcrumb(breadcrumb) {
            return sanitizeTelemetryBreadcrumb(breadcrumb);
          },
          beforeSend(event, hint) {
            if (isProviderFailureHandled(hint.originalException)) return null;
            return sanitizeTelemetryEvent(event, {
              layer: 'next_server',
              channel: config.channel,
              platform: process.platform,
              arch: process.arch,
            });
          },
        });
        if (telemetrySmokeEnabled(process.env.NEXT_PUBLIC_CODEPILOT_TELEMETRY_SMOKE)) {
          const eventId = Sentry.captureException(createTelemetrySmokeError('next_server'));
          console.log(`[telemetry-smoke] layer=next_server event_id=${eventId}`);
          await Sentry.flush(5_000);
        }
      }
    }

    const { initRuntimeLog } = await import('@/lib/runtime-log');
    initRuntimeLog();

    // Start the task scheduler so persisted tasks resume on cold boot
    // (previously only started as a side effect of /api/chat)
    const { ensureSchedulerRunning } = await import('@/lib/task-scheduler');
    ensureSchedulerRunning();
  }
}
