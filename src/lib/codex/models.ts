/**
 * Codex model fetch helpers — Phase 5 Phase 2 (2026-05-13).
 *
 * Wraps `model/list` and maps the upstream `Model` shape into both
 * the narrow internal `CodexModel` and CodePilot's existing
 * `ProviderModelGroup` so the chat picker can render Codex models
 * alongside other providers.
 *
 * Caching: short in-process TTL (30s) + manual refresh button on
 * the Codex Settings card. Account update / logout invalidates the
 * cache via `invalidateCodexModelsCache()`.
 */

import type { ProviderModelGroup } from '@/types';
import type { CodexModel } from './types';
import { getCodexAppServer } from './app-server-manager';

type ProviderModelOption = ProviderModelGroup['models'][number];

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  fetchedAt: number;
  models: readonly CodexModel[];
}

let cache: CacheEntry | null = null;

/**
 * Fetch model/list and narrow to `CodexModel[]`. Honors the cache
 * unless `force: true` is passed.
 */
export async function listCodexModels(force = false): Promise<readonly CodexModel[]> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models;
  }
  const { client } = await getCodexAppServer();
  const result = await client.request<{
    data: Array<{
      id: string;
      model: string;
      displayName: string;
      description: string;
      hidden: boolean;
      isDefault: boolean;
      supportedReasoningEfforts: Array<{ effort: string }>;
      defaultReasoningEffort: string;
      inputModalities: string[];
      serviceTiers?: Array<{ id?: string; name?: string }>;
    }>;
    nextCursor: string | null;
  }>('model/list', { includeHidden: false });

  const models: CodexModel[] = result.data
    .filter((m) => !m.hidden)
    .map((m) => ({
      id: m.id,
      model: m.model,
      displayName: m.displayName,
      description: m.description,
      hidden: m.hidden,
      isDefault: m.isDefault,
      supportedReasoningEfforts: m.supportedReasoningEfforts.map((e) => e.effort),
      defaultReasoningEffort: m.defaultReasoningEffort,
      inputModalities: m.inputModalities,
      serviceTiers: m.serviceTiers?.map((t) => t.name ?? t.id ?? ''),
    }));

  cache = { fetchedAt: Date.now(), models };
  return models;
}

/** Drop the in-memory model cache. Call on account change / logout. */
export function invalidateCodexModelsCache(): void {
  cache = null;
}

/**
 * Build the CodePilot ProviderModelGroup that surfaces Codex Account
 * models inside `/api/providers/models`. Returns null when no models
 * are available (account not logged in or list call failed).
 *
 * The group claims `compat: 'codex_account'` so `getModelCompat`
 * marks each model with `supportedRuntimes: ['codex_runtime']`.
 */
export async function buildCodexProviderModelGroup(): Promise<ProviderModelGroup | null> {
  let models: readonly CodexModel[];
  try {
    models = await listCodexModels();
  } catch {
    // Network / login error — surface as no group rather than throw.
    // Callers (Settings status card) read /api/codex/status separately
    // to know WHY models aren't appearing.
    return null;
  }

  if (models.length === 0) return null;

  const modelOptions: ProviderModelOption[] = models.map((m) => ({
    value: m.id,
    label: m.displayName,
    upstreamModelId: m.model,
    source: 'api',
    capabilities: {
      reasoning: m.supportedReasoningEfforts.length > 1,
      supportsEffort: m.supportedReasoningEfforts.length > 1,
      supportedEffortLevels: [...m.supportedReasoningEfforts],
      // We don't have an authoritative tool-use signal from
      // `model/list` — Codex routes tool-calling through its own
      // app-server thread rather than per-model capability. Default
      // true so the picker doesn't surface a misleading "no tools"
      // badge; the actual tool inventory is per-thread.
      toolUse: true,
    },
  }));

  return {
    provider_id: 'codex_account',
    provider_name: 'Codex Account',
    provider_type: 'codex',
    compat: 'codex_account',
    models: modelOptions,
  };
}
