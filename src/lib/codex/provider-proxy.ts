/**
 * Codex provider-proxy injection helper.
 *
 * Phase 5 Phase 5 (2026-05-13). Builds the `config` override passed
 * to Codex `thread/start` so Codex resolves the user's targeted
 * CodePilot provider through our local proxy route instead of trying
 * to call the upstream API directly.
 *
 * Codex schema: `ThreadStartParams.config?: { [key: string]: JsonValue }`
 * is a free-form override map. The proxy injection sets:
 *
 *   config.model_providers = {
 *     codepilot_proxy: {
 *       name: 'CodePilot via Codex',
 *       base_url: 'http://127.0.0.1:<port>/api/codex/proxy/v1',
 *       wire_api: 'responses',
 *       http_headers: { 'x-codepilot-target-provider': '<provider-id>' },
 *     }
 *   }
 *
 * The header is how the proxy route knows which CodePilot provider
 * the user picked. We use a header (not a query string) because
 * Codex's HTTP client adds them to every request to that provider
 * without needing per-request override plumbing.
 *
 * Phase 5b status: the proxy route is fully implemented for every
 * recognised compat tier via the unified translator at
 * `src/lib/codex/proxy/unified-adapter.ts`. CodexRuntime.stream()
 * threads provider id through to `buildCodexThreadStartParams`
 * below, so a non-codex_account provider's first message creates
 * a thread bound to the proxy injection; subsequent messages on the
 * same chat session resume that thread as long as the provider
 * binding still matches (mismatch detection in `runtime.ts`).
 */

const PROVIDER_KEY = 'codepilot_proxy' as const;

export interface CodexProxyInjection {
  modelProvider: typeof PROVIDER_KEY;
  config: {
    model_providers: {
      [PROVIDER_KEY]: {
        name: string;
        base_url: string;
        wire_api: 'responses';
        http_headers: Record<string, string>;
      };
    };
  };
}

/**
 * Build the Codex thread/start config override that routes a target
 * CodePilot provider through the local Responses proxy.
 *
 * @param targetProviderId — CodePilot provider DB id (used by the
 *   proxy route via x-codepilot-target-provider header to look up
 *   the provider record and decide compat / forwarding).
 * @param baseUrl — absolute URL CodePilot is reachable at from
 *   wherever Codex runs (usually `http://127.0.0.1:<port>` in dev,
 *   localhost in packaged Electron).
 */
export function buildCodexProviderProxyInjection(
  targetProviderId: string,
  baseUrl: string,
): CodexProxyInjection {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return {
    modelProvider: PROVIDER_KEY,
    config: {
      model_providers: {
        [PROVIDER_KEY]: {
          name: 'CodePilot via Codex',
          base_url: `${trimmed}/api/codex/proxy/v1`,
          wire_api: 'responses',
          http_headers: {
            'x-codepilot-target-provider': targetProviderId,
          },
        },
      },
    },
  };
}

/**
 * Build the `thread/start` params for a Codex thread tied to the
 * resolved provider id. Centralised so the runtime and its tests
 * use one expression for the proxy-injection wiring.
 *
 *   - `'codex_account'` (virtual provider) → no injection. The thread
 *     uses Codex's own model_providers map keyed under its native
 *     OAuth account.
 *   - any non-empty non-`'env'` providerId → proxy injection so Codex
 *     routes upstream calls through `/api/codex/proxy/v1/responses`.
 *   - empty / `'env'` → caller MUST reject before reaching this fn;
 *     this is an unreachable contract violation that we surface as
 *     a thrown error rather than silently constructing a no-op.
 */
export function buildCodexThreadStartParams(opts: {
  providerId: string;
  workingDirectory?: string;
  proxyBaseUrl: string;
}): { cwd?: string; modelProvider?: string; config?: CodexProxyInjection['config'] } {
  const providerId = opts.providerId.trim();
  if (!providerId || providerId === 'env') {
    throw new Error(
      'buildCodexThreadStartParams called with env / empty providerId — caller must reject the request before building thread/start params.',
    );
  }
  const base: { cwd?: string } = {};
  if (opts.workingDirectory) base.cwd = opts.workingDirectory;
  if (providerId === 'codex_account') return base;
  const injection = buildCodexProviderProxyInjection(providerId, opts.proxyBaseUrl);
  return {
    ...base,
    modelProvider: injection.modelProvider,
    config: injection.config,
  };
}

/**
 * Resolve the base URL CodePilot's Next server is reachable at from
 * the Codex app-server's perspective. In dev + Electron the
 * app-server is a child process on the same host, so 127.0.0.1
 * + the dev port works. The env var override is for unusual
 * deployments (containerized testing, remote Codex etc.).
 */
export function resolveCodexProxyBaseUrl(): string {
  return (
    process.env.CODEPILOT_PROXY_BASE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? '3000'}`
  );
}

export const CODEX_PROXY_PROVIDER_KEY = PROVIDER_KEY;
