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
 *   4. dispatch to the per-family translator (OpenAI-compat /
 *      Anthropic-compat / CodePlan)
 *   5. return either a streaming Response (Responses SSE) or a
 *      JSON Response (Responses non-stream object).
 *
 * Until the per-family translators land in their own sub-commits,
 * step 4 returns a structured `adapter_not_implemented` error
 * encoded in the actual Responses wire format (a `response.failed`
 * SSE event when stream:true, a JSON body when stream:false). This
 * is the load-bearing difference from the pre-5b scaffold: Codex's
 * HTTP client no longer sees a generic 501, it sees a valid
 * Responses error object it can branch on.
 *
 * Adapter contract for sub-commits:
 *
 *   type ResponsesAdapter = (
 *     input: ProxyHandlerInput,
 *     resolved: ResolvedProvider,
 *   ) => Promise<ProxyResult>;
 *
 * Each adapter file (openai-compat.ts / anthropic-compat.ts /
 * codeplan.ts) exports the implementation; this file's registry maps
 * AdapterFamily → adapter. Flipping a family from stub to real
 * implementation is a single registry edit.
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
const ADAPTERS: Record<AdapterFamily, ResponsesAdapter> = {
  openai_compatible: makeNotImplementedAdapter('openai_compatible'),
  anthropic_compatible: makeNotImplementedAdapter('anthropic_compatible'),
  codeplan: makeNotImplementedAdapter('codeplan'),
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
  switch (family) {
    case 'openai_compatible':
      return `Codex provider proxy: OpenAI-compatible adapter is being wired (Phase 5b). "${providerName}" will go live once the OpenAI-compatible translator ships.`;
    case 'anthropic_compatible':
      return `Codex provider proxy: Anthropic-compatible adapter is being wired (Phase 5b). "${providerName}" will go live once the Anthropic-compatible translator ships.`;
    case 'codeplan':
      return `Codex provider proxy: CodePlan / 套餐型 adapter is being wired (Phase 5b). "${providerName}" will go live once the brand-shaped translator ships.`;
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
