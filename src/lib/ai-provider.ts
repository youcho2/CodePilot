/**
 * ai-provider.ts — Unified AI model factory for the native Agent Loop.
 *
 * Creates a Vercel AI SDK LanguageModel from a ResolvedProvider + model override.
 * Both text-generator.ts (simple generation) and agent-loop.ts (agentic chat)
 * call through this module so provider handling is defined in exactly one place.
 *
 * Key design decisions (from comparative analysis of OpenCode, Claude Code, Craft Agents):
 * - BaseURL normalisation: append /v1 for bare domains (Anthropic proxies expect /v1/messages)
 * - Model ID: always resolve to full upstream ID, never send short aliases to API
 * - Beta headers: match OpenCode's set for proxy compatibility
 * - Third-party proxy safety: disable adaptive thinking (not widely supported by proxies)
 */

import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import {
  type ResolvedProvider,
  type AiSdkConfig,
  resolveProvider,
  toAiSdkConfig,
} from './provider-resolver';
import { getOAuthCredentialsSync } from './openai-oauth-manager';

// ── Public API ──────────────────────────────────────────────────

export interface CreateModelOptions {
  providerId?: string;
  sessionProviderId?: string;
  model?: string;
  sessionModel?: string;
}

export interface CreateModelResult {
  languageModel: LanguageModel;
  modelId: string;
  config: AiSdkConfig;
  resolved: ResolvedProvider;
  /** True when using a third-party proxy (not api.anthropic.com) */
  isThirdPartyProxy: boolean;
}

/**
 * Resolve provider + model and create a Vercel AI SDK LanguageModel instance.
 */
export function createModel(opts: CreateModelOptions = {}): CreateModelResult {
  const resolved = resolveProvider({
    providerId: opts.providerId,
    sessionProviderId: opts.sessionProviderId,
    model: opts.model,
    sessionModel: opts.sessionModel,
  });

  if (!resolved.hasCredentials && !resolved.provider) {
    throw new Error(
      'No provider credentials available. Please configure a provider in Settings or set ANTHROPIC_API_KEY.',
    );
  }

  const config = toAiSdkConfig(resolved, opts.model || opts.sessionModel);

  // ── Model ID resolution ─────────────────────────────────────
  // toAiSdkConfig tries to resolve via availableModels catalog, but if
  // upstreamModelId is undefined (common for user-configured providers),
  // modelId remains a short alias like "sonnet". We must resolve it further.
  //
  // Resolution chain (matching Claude Code SDK's env var approach):
  // 1. Provider's roleModels (sonnet/opus/haiku → provider-specific upstream ID)
  // 2. Hardcoded Anthropic defaults (for env-mode without provider)
  // Model ID: trust what toAiSdkConfig resolved.
  // It uses the provider's availableModels catalog → upstreamModelId.
  // If no upstream mapping exists, pass the alias as-is (proxies often accept short aliases).
  // Only for env-mode (no provider) with bare aliases, map to current Anthropic defaults.
  if (!resolved.provider && isShortAlias(config.modelId)) {
    const CURRENT_DEFAULTS: Record<string, string> = {
      sonnet: 'claude-sonnet-4-5-20250929',
      opus: 'claude-opus-4-6',
      haiku: 'claude-haiku-4-5-20251001',
    };
    config.modelId = CURRENT_DEFAULTS[config.modelId] || config.modelId;
  }

  // Inject process env if needed (bedrock/vertex)
  for (const [k, v] of Object.entries(config.processEnvInjections)) {
    process.env[k] = v;
  }

  const isThirdPartyProxy = config.sdkType === 'anthropic' &&
    !!config.baseUrl && !isOfficialAnthropicUrl(config.baseUrl);

  const languageModel = createLanguageModel(config, isThirdPartyProxy);

  return { languageModel, modelId: config.modelId, config, resolved, isThirdPartyProxy };
}

function isShortAlias(modelId: string): boolean {
  return ['sonnet', 'opus', 'haiku'].includes(modelId);
}

// ── URL helpers ─────────────────────────────────────────────────

function isOfficialAnthropicUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com');
  } catch {
    return false;
  }
}

/**
 * @ai-sdk/anthropic appends `/messages` to baseURL.
 * Default is `https://api.anthropic.com/v1` → `/v1/messages`.
 * Third-party proxies expect the same, but users often omit `/v1`.
 */
function normaliseBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const cleaned = url.replace(/\/+$/, '');
  if (cleaned.endsWith('/v1')) return cleaned;
  // Has a deeper path (e.g. /api/anthropic) — don't touch
  try {
    const pathname = new URL(cleaned).pathname;
    if (pathname !== '/' && pathname !== '') return cleaned;
  } catch { return cleaned; }
  return `${cleaned}/v1`;
}

// ── Provider creation ───────────────────────────────────────────

// Beta headers matching OpenCode's anthropic custom loader.
// Ref: opencode-dev/packages/opencode/src/provider/provider.ts lines 120-131
const ANTHROPIC_BETA_HEADERS = [
  'interleaved-thinking-2025-05-14',
];

function createLanguageModel(config: AiSdkConfig, isThirdPartyProxy: boolean): LanguageModel {
  const hasHeaders = Object.keys(config.headers || {}).length > 0;

  switch (config.sdkType) {
    case 'anthropic': {
      const baseURL = normaliseBaseUrl(config.baseUrl);
      const headers: Record<string, string> = {
        'anthropic-beta': ANTHROPIC_BETA_HEADERS.join(','),
        ...config.headers,
      };

      const anthropic = createAnthropic({
        ...(config.authToken
          ? { authToken: config.authToken }
          : { apiKey: config.apiKey }),
        baseURL,
        headers,
      });
      return anthropic(config.modelId);
    }

    case 'claude-code-compat': {
      const { createClaudeCodeCompatModel } = require('./claude-code-compat') as typeof import('./claude-code-compat');
      return createClaudeCodeCompatModel({
        apiKey: config.apiKey,
        authToken: config.authToken,
        baseUrl: config.baseUrl || 'https://api.anthropic.com/v1',
        modelId: config.modelId,
        headers: config.headers,
      }) as unknown as LanguageModel;
    }

    case 'openai': {
      // OpenAI OAuth (Codex API) — use custom fetch to rewrite URL + inject auth
      // Pattern from opencode-dev's codex.ts plugin
      if (config.useResponsesApi) {
        const creds = getOAuthCredentialsSync();
        if (!creds) {
          throw new Error('OpenAI OAuth token expired or not available. Please log in again in Settings.');
        }
        const codexEndpoint = config.baseUrl
          ? `${config.baseUrl}/responses`
          : 'https://chatgpt.com/backend-api/codex/responses';
        const accountId = creds.accountId;
        const accessToken = creds.accessToken;

        const openai = createOpenAI({
          apiKey: 'codex-oauth',  // placeholder — overridden by custom fetch
          // Keep default baseURL so SDK constructs valid paths
          fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
            // Rewrite URL to Codex endpoint
            const reqUrl = url instanceof URL ? url : new URL(url as string);
            const targetUrl = reqUrl.pathname.includes('/responses')
              ? new URL(codexEndpoint)
              : reqUrl;

            // Build headers with OAuth credentials
            const headers = new Headers(init?.headers);
            // Remove SDK's dummy auth, inject real OAuth token
            headers.delete('Authorization');
            headers.delete('authorization');
            headers.set('Authorization', `Bearer ${accessToken}`);
            if (accountId) {
              headers.set('chatgpt-account-id', accountId);
            }

            console.log(`[openai-codex] Fetching: ${targetUrl.toString()} model=${config.modelId}`);
            const resp = await fetch(targetUrl, { ...init, headers });
            if (!resp.ok) {
              const body = await resp.clone().text().catch(() => '');
              console.error(`[openai-codex] ${resp.status} ${resp.statusText}:`, body.slice(0, 500));
            }
            return resp;
          },
        });
        return openai.responses(config.modelId);
      }

      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        ...(hasHeaders ? { headers: config.headers } : {}),
      });
      return openai(config.modelId);
    }

    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        ...(hasHeaders ? { headers: config.headers } : {}),
      });
      return google(config.modelId);
    }

    case 'bedrock': {
      const bedrock = createAmazonBedrock({
        ...(hasHeaders ? { headers: config.headers } : {}),
      });
      return bedrock(config.modelId);
    }

    case 'vertex': {
      const vertex = createVertexAnthropic({
        ...(hasHeaders ? { headers: config.headers } : {}),
      });
      return vertex(config.modelId);
    }

    default: {
      const anthropic = createAnthropic({
        ...(config.authToken
          ? { authToken: config.authToken }
          : { apiKey: config.apiKey }),
        baseURL: config.baseUrl,
        ...(hasHeaders ? { headers: config.headers } : {}),
      });
      return anthropic(config.modelId);
    }
  }
}
