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
 * Build the shared `cwd / modelProvider / config` payload that BOTH
 * `thread/start` and `thread/resume` need. Codex's
 * `ThreadResumeParams` schema (codex-rs/.../v2/ThreadResumeParams.ts)
 * accepts `modelProvider`, `config`, and `cwd` exactly like
 * `ThreadStartParams`. Phase 5b previously passed these only on start
 * — the resume path inherited whatever the Codex server still had in
 * memory for the thread. That breaks when:
 *
 *   1. CodePilot's dev port changed between turns (proxy base_url is
 *      no longer valid in the cached config).
 *   2. The Codex app-server restarted between turns (in-memory thread
 *      metadata cleared; resume reload from disk may or may not
 *      include the codepilot_proxy entry depending on persistence).
 *   3. A future Codex version normalises thread state and prunes
 *      unknown model_providers across reloads.
 *
 * Always re-attaching the same payload on resume avoids all three
 * cases. Codex treats resume-time overrides as authoritative for the
 * resumed thread per the schema's "Configuration overrides for the
 * resumed thread" docstring.
 *
 *   - `'codex_account'` (virtual provider) → no injection. The thread
 *     uses Codex's own model_providers map keyed under its native
 *     OAuth account.
 *   - any non-empty non-`'env'` providerId → proxy injection so Codex
 *     routes upstream calls through `/api/codex/proxy/v1/responses`.
 *   - empty / `'env'` → caller MUST reject before reaching this fn;
 *     this is an unreachable contract violation that we surface as
 *     a thrown error rather than silently constructing a no-op.
 *
 * The return shape is intentionally a plain object the runtime
 * spreads into either `{ ...params }` (for thread/start) or
 * `{ threadId, ...params }` (for thread/resume).
 */
export interface CodexThreadParams {
  cwd?: string;
  modelProvider?: string;
  config?: CodexProxyInjection['config'];
}

export function buildCodexThreadParams(opts: {
  providerId: string;
  workingDirectory?: string;
  proxyBaseUrl: string;
}): CodexThreadParams {
  const providerId = opts.providerId.trim();
  if (!providerId || providerId === 'env') {
    throw new Error(
      'buildCodexThreadParams called with env / empty providerId — caller must reject the request before building thread params.',
    );
  }
  const base: CodexThreadParams = {};
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
 * @deprecated Phase 5b P1 follow-up — prefer `buildCodexThreadParams`.
 * Kept as an alias so existing callers (and the regression test that
 * pins the start-only contract) compile. The shape and semantics are
 * identical; only the name changed to reflect that the helper now
 * serves resume too.
 */
export const buildCodexThreadStartParams = buildCodexThreadParams;

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
