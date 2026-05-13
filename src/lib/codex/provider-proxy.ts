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
 * MVP today: the proxy route returns structured 501 unsupported_yet
 * for every compat tier (see `src/app/api/codex/proxy/v1/responses/route.ts`
 * for the docstring on scope). The injection PATH is wired so that
 * when Phase 5b lands the actual Responses translator, no runtime
 * changes are needed — the same config override pattern just starts
 * succeeding.
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
