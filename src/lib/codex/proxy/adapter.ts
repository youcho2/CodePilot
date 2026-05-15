/**
 * Phase 5b — Codex Responses proxy entry point.
 *
 * The route file (`/api/codex/proxy/v1/responses`) calls
 * `handleProxyRequest` with the parsed request body, the target
 * provider header, and the inbound abort signal. The function does:
 *
 *   1. validate / parse the request body
 *   2. look up the target CodePilot provider in the DB
 *   3. classify its compat tier + adapter family
 *   4. dispatch to the unified adapter (per the registry below)
 *   5. return either a streaming Response (Responses SSE) or a
 *      JSON Response (Responses non-stream object).
 *
 * Phase 5b shipped a single `createUnifiedAdapter` implementation that
 * serves all three CodePilot families (OpenAI-compatible, Anthropic-
 * compatible / ClaudeCode-compatible, CodePlan / 套餐型). The wire-
 * format divergence between families lives INSIDE ai-sdk's per-tier
 * SDK selection (createAnthropic / createOpenAI / claude-code-compat
 * / etc.), so the proxy doesn't need a per-family translator — the
 * registry below maps every family-name slot to the same adapter.
 * `unknown` is the only tier that stays gated (the proxy can't infer
 * the wire format without more info — it surfaces as
 * `adapter_not_implemented`).
 *
 * Adapter contract:
 *
 *   type ResponsesAdapter = (
 *     input: ProxyHandlerInput,
 *     resolved: ResolvedProvider,
 *   ) => Promise<ProxyResult>;
 *
 * The runtime override `registerAdapter` is retained so targeted
 * tests can substitute a stub for one family without recompiling.
 */

import { resolveProvider, type ResolvedProvider } from '@/lib/provider-resolver';
import { getProvider } from '@/lib/db';
import {
  ADAPTER_FAMILY_BY_COMPAT,
  ADAPTER_STATUS_BY_COMPAT,
  type AdapterFamily,
} from './provider-parity';
import { getProviderCompatFromApi } from '@/lib/runtime-compat';
import { makeErrorResult, classifyUpstreamError } from './errors';
import { createUnifiedAdapter } from './unified-adapter';
import type {
  ProxyHandlerInput,
  ProxyResult,
  ResponsesRequestBody,
  ResponsesErrorPayload,
} from './types';

/**
 * Per-adapter handler signature. The adapter receives the parsed
 * request + the resolved provider record + the abort signal, and
 * must return either:
 *
 *   - a `kind: 'stream'` result whose body is a ReadableStream of
 *     SSE-framed Responses events (terminated with `data: [DONE]`)
 *   - a `kind: 'json'` result with a complete Responses object
 *   - a `kind: 'error'` result the caller maps to HTTP status.
 *
 * Adapters MUST NOT throw — wrap any internal failure via
 * `classifyUpstreamError` so Codex's reader sees a structured error.
 */
export type ResponsesAdapter = (
  input: ProxyHandlerInput,
  resolved: ResolvedProvider,
) => Promise<ProxyResult>;

/**
 * Adapter registry. Sub-commits replace the `notImplementedAdapter`
 * entries with real implementations:
 *
 *   openai_compatible    → ./adapters/openai-compat.ts
 *   anthropic_compatible → ./adapters/anthropic-compat.ts
 *   codeplan             → ./adapters/codeplan.ts
 *
 * `native` should never appear in dispatch (codex_account routes
 * through Codex's own app-server, media_only doesn't reach chat).
 * Defensive entry surfaces a clear error if a misroute happens.
 */
// Registry is populated at module init. The unified translator serves
// all three families today; keeping the wiring static makes the
// dispatch surface easier to read than the sub-commit-era runtime
// registration pattern.
const ADAPTERS: Record<AdapterFamily, ResponsesAdapter> = {
  openai_compatible: createUnifiedAdapter('openai_compatible'),
  anthropic_compatible: createUnifiedAdapter('anthropic_compatible'),
  codeplan: createUnifiedAdapter('codeplan'),
  native: async () => makeErrorResult(
    'internal_error',
    'Provider routed to the Codex proxy but its compat tier is native (Codex Account / media-only). This is a routing bug — the provider should not have been injected into Codex thread/start config.',
  ),
};

/**
 * Register a real adapter implementation. Called by each sub-commit
 * from its module init (or test setup) to swap the stub for the
 * real translator. Keeping this as a runtime register (rather than
 * a static import of every adapter) lets sub-commits land one at a
 * time without touching every other file.
 */
export function registerAdapter(family: AdapterFamily, adapter: ResponsesAdapter): void {
  ADAPTERS[family] = adapter;
}

/**
 * Main entry. Route file passes the inbound request shape; we
 * dispatch and return a ProxyResult the route serialises into the
 * actual HTTP Response.
 */
export async function handleProxyRequest(
  input: ProxyHandlerInput,
): Promise<ProxyResult> {
  // 1. Provider lookup.
  if (!input.targetProviderId) {
    return makeErrorResult(
      'provider_not_targeted',
      'Codex proxy invoked without the x-codepilot-target-provider header. The runtime config injection should set this — check `buildCodexProviderProxyInjection` wiring.',
    );
  }
  const dbProvider = getProvider(input.targetProviderId);
  if (!dbProvider) {
    return makeErrorResult(
      'provider_not_found',
      `Target CodePilot provider not found: ${input.targetProviderId}.`,
      { providerId: input.targetProviderId },
    );
  }

  // 2. Classify compat tier + adapter family.
  const compat = getProviderCompatFromApi(dbProvider);
  const family = ADAPTER_FAMILY_BY_COMPAT[compat];
  const status = ADAPTER_STATUS_BY_COMPAT[compat];

  // 3. Resolve via the canonical provider-resolver so the adapter
  //    gets the same `ResolvedProvider` shape Native runtime uses.
  //    The resolver fills in credentials, baseUrl, model alias →
  //    upstream id translation, sdkType, etc.
  const resolved = resolveProvider({
    providerId: dbProvider.id,
    model: input.body.model,
  });

  // 4. Credentials check. We do this before adapter dispatch so the
  //    user sees `credentials_missing` instead of a downstream
  //    `upstream_unauthorized` after a failed HTTP call.
  if (!resolved.hasCredentials) {
    return makeErrorResult(
      'credentials_missing',
      `Provider "${dbProvider.name}" has no credentials configured. Add an API key in Settings → 服务商 or remove the model from Codex thread config.`,
      { providerId: dbProvider.id, providerName: dbProvider.name, compat },
    );
  }

  // 5. Adapter-status gate. When the family's adapter is still
  //    pending, return a structured Responses-format error rather
  //    than a generic 501. Codex's reader treats this like any
  //    upstream failure (shows the user the message verbatim) and
  //    we get full visibility into "which provider hit which
  //    missing adapter" via the context object.
  if (status === 'pending') {
    return makeErrorResult(
      'adapter_not_implemented',
      buildPendingMessage(family, dbProvider.name),
      { providerId: dbProvider.id, providerName: dbProvider.name, compat, family },
    );
  }
  if (status === 'not_applicable') {
    return makeErrorResult(
      'internal_error',
      `Provider "${dbProvider.name}" (compat=${compat}) routed to the Codex proxy but its tier doesn't go through here. This is a routing bug.`,
      { providerId: dbProvider.id, providerName: dbProvider.name, compat },
    );
  }

  // 6. Dispatch to the per-family adapter. Adapter is responsible
  //    for never throwing — but wrap defensively so a bug in
  //    upstream code doesn't kill Codex's HTTP read loop.
  const adapter = ADAPTERS[family];
  try {
    return await adapter(input, resolved);
  } catch (err) {
    const classified = classifyUpstreamError(err);
    return makeErrorResult(classified.code, classified.message, classified.context);
  }
}

function buildPendingMessage(family: AdapterFamily, providerName: string): string {
  // Phase 5b shipped a unified adapter that covers every known family,
  // so the only path that still hits "pending" is the `unknown` provider
  // tier (compat = 'unknown'). That tier still routes to the
  // `openai_compatible` family slot in the parity registry because
  // OpenAI-shape chat/completions is the most common third-party
  // shape — but until a user explicitly verifies the wire format, the
  // proxy refuses to guess and surfaces a clear "wire format
  // unidentified" message. Other families CANNOT reach this branch
  // (status='ready'); the switch arms below remain defensive in case
  // a future regression flips a family back to 'pending'.
  switch (family) {
    case 'openai_compatible':
      return `Codex provider proxy: cannot determine the wire format for "${providerName}". Set the provider's protocol to a recognised value (openai-compat / anthropic-compat / etc.) so the proxy can pick the right translator.`;
    case 'anthropic_compatible':
      return `Codex provider proxy: "${providerName}" classifies as Anthropic-compatible but the adapter is currently disabled. Re-enable the adapter family or pick a different provider.`;
    case 'codeplan':
      return `Codex provider proxy: "${providerName}" classifies as a CodePlan / 套餐型 brand but the adapter is currently disabled. Re-enable the adapter family or pick a different provider.`;
    case 'native':
      return `Provider "${providerName}" routes through Codex natively, not through the proxy.`;
  }
}

function makeNotImplementedAdapter(family: AdapterFamily): ResponsesAdapter {
  // Should never actually run — the status gate above short-circuits
  // before reaching the adapter. Defensive fallback so a registry
  // edit that forgets to set status='ready' surfaces a clear message.
  return async () => makeErrorResult(
    'adapter_not_implemented',
    `${family} adapter not yet registered. This is a wiring bug — adapter status should have gated this call earlier.`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — exported for tests
// ─────────────────────────────────────────────────────────────────────

/** Generate the response id Codex echoes back in completion events. */
export function makeResponseId(): string {
  return `resp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Synthesise the `response.failed` SSE payload from an error result. */
export function failedEventFromError(
  responseId: string,
  error: ResponsesErrorPayload,
): import('./types').ResponsesFailedEvent {
  return {
    type: 'response.failed',
    response: { id: responseId },
    error,
  };
}

/** Synthesise the initial `response.created` SSE payload. */
export function createdEventFor(
  responseId: string,
  body: ResponsesRequestBody,
): import('./types').ResponsesCreatedEvent {
  return {
    type: 'response.created',
    response: {
      id: responseId,
      model: body.model,
      created_at: Math.floor(Date.now() / 1000),
    },
  };
}
