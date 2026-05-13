/**
 * /api/codex/proxy/v1/responses
 *
 * Phase 5 Phase 5 — CodePilot provider proxy MVP scaffold
 * (2026-05-13).
 *
 * Surface area Codex's `model-provider-info` config sees when it
 * resolves a thread's `modelProvider` to a CodePilot-bridged provider.
 * The route URL is what gets injected into Codex's `model_providers`
 * map at `thread/start` time via the `config` override
 * (`ThreadStartParams.config.model_providers`).
 *
 * Honest scope of this commit:
 *
 *   - The route EXISTS and is reachable; Codex's HTTP client gets a
 *     deterministic structured 501 instead of a hung connection.
 *   - The structured error names the provider compat tier so the UI
 *     can surface why the route can't serve it ("OpenAI-compatible
 *     forwarding lands in Phase 5b" / "ClaudeCode-compatible needs
 *     a Responses→Anthropic translator — Phase 5c").
 *   - The actual Responses-API → CodePilot transport translation is
 *     NOT implemented. Without a local codex binary to e2e the
 *     wire format against, writing the translator now would be
 *     guesswork the user has already pushed back on.
 *
 * Phase 5b deliverables (next slice when codex binary is available):
 *   - Parse Responses request body (input items: text + tool calls +
 *     tool outputs; tools array; model; stream flag).
 *   - Resolve the target CodePilot provider via the existing
 *     provider-resolver, run the request through provider-transport.
 *   - Translate the upstream chat-completions response back into
 *     Responses event format (response.created /
 *     response.output_text.delta / response.completed / etc).
 *   - Streaming variant via SSE.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getProvider } from '@/lib/db';
import { getProviderCompatFromApi } from '@/lib/runtime-compat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type ProxyUnsupportedReason =
  | 'no_provider_targeted'
  | 'provider_not_found'
  | 'codepilot_responses_translator_pending'
  | 'anthropic_translator_pending'
  | 'codex_account_routes_natively';

interface ProxyErrorBody {
  error: {
    type: 'unsupported_yet';
    code: ProxyUnsupportedReason;
    /** Short human-readable description; UI surfaces this directly. */
    message: string;
    /** Optional context — provider id / compat tier / etc. */
    context?: Record<string, unknown>;
  };
}

function unsupported(
  code: ProxyUnsupportedReason,
  message: string,
  context?: Record<string, unknown>,
): NextResponse<ProxyErrorBody> {
  return NextResponse.json<ProxyErrorBody>(
    {
      error: {
        type: 'unsupported_yet',
        code,
        message,
        ...(context ? { context } : {}),
      },
    },
    { status: 501 },
  );
}

export async function POST(request: NextRequest) {
  // Provider target is signalled via a header (the runtime injection
  // sets it when constructing the provider config Codex will use).
  // Body parsing is deferred to Phase 5b — we only need to know
  // WHICH CodePilot provider was targeted so we can return the
  // correct unsupported reason for its compat tier.
  const targetProviderId = request.headers.get('x-codepilot-target-provider') ?? '';

  if (!targetProviderId) {
    return unsupported(
      'no_provider_targeted',
      'Codex proxy invoked without x-codepilot-target-provider header. Runtime injection should set this.',
    );
  }

  const provider = getProvider(targetProviderId);
  if (!provider) {
    return unsupported(
      'provider_not_found',
      `CodePilot provider not found: ${targetProviderId}`,
      { providerId: targetProviderId },
    );
  }

  const compat = getProviderCompatFromApi(provider);

  switch (compat) {
    case 'codepilot_only':
      // OpenAI-compatible providers — easiest first target for the
      // Responses translation. Scaffold returns the same 501 today;
      // Phase 5b implements the actual forward.
      return unsupported(
        'codepilot_responses_translator_pending',
        'OpenAI-compatible CodePilot provider — Responses-API translator lands in Phase 5b.',
        { providerId: targetProviderId, compat },
      );

    case 'claude_code_ready':
    case 'claude_code_verified':
    case 'claude_code_experimental':
    case 'openrouter_anthropic_skin':
      return unsupported(
        'anthropic_translator_pending',
        'Anthropic-shaped provider — Responses→Anthropic translation layer lands in Phase 5c after the OpenAI path is validated.',
        { providerId: targetProviderId, compat },
      );

    case 'codex_account':
      // Codex Account models route through Codex's own provider
      // config, not through this proxy. Surface as a config error
      // so the operator catches the misconfiguration.
      return unsupported(
        'codex_account_routes_natively',
        'Codex Account models route through Codex natively, not through the CodePilot proxy. Check provider injection logic.',
        { providerId: targetProviderId, compat },
      );

    case 'media_only':
    case 'unknown':
    default:
      return unsupported(
        'codepilot_responses_translator_pending',
        `Provider compat tier "${compat}" cannot be routed through the Codex proxy yet.`,
        { providerId: targetProviderId, compat },
      );
  }
}
