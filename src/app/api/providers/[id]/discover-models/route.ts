import { NextRequest, NextResponse } from 'next/server';
import { getProvider, getAllModelsForProvider } from '@/lib/db';
import { findMatchingPresetForRecord } from '@/lib/provider-catalog';
import { discoverModels, classifyProvider } from '@/lib/model-discovery';
import type { ErrorResponse, ProviderModel } from '@/types';

/**
 * Strip Gemini's `models/` prefix so the canonical id matches what every
 * other surface (model_id, default-model selector, role_models_json) uses.
 */
function normalizeModelId(raw: string): string {
  return raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
}

type DiffEntryStatus =
  /** Upstream model with no matching DB row — fresh add. */
  | 'new'
  /** Upstream model + DB row exists, user has not edited — display_name will refresh from upstream. */
  | 'will-update'
  /** Upstream model + DB row exists with user edits — only upstream_model_id / source / last_refreshed_at touched. */
  | 'preserve-edited'
  /** Upstream model + DB row exists, hidden by user (enabled=0) — stays hidden. */
  | 'hidden-but-upstream'
  /** Upstream model that is bit-identical to the DB row — no-op refresh. */
  | 'unchanged'
  /** DB row not seen in upstream this round — orphan; left alone, surfaced for review. */
  | 'orphan';

interface DiffEntry {
  modelId: string;
  upstreamModelId: string;
  status: DiffEntryStatus;
  current?: {
    display_name: string;
    enabled: number;
    user_edited: number;
    source: string;
  };
}

/**
 * POST /api/providers/[id]/discover-models
 *
 * Probes the upstream for its model list and returns a **diff** against
 * `provider_models` — the route does NOT write. Callers (the Models page +
 * the per-card "Refresh models" dialog) review the diff and POST it to
 * `/discover-models/apply` if they want it applied.
 *
 * This intentionally reverses the earlier auto-write behaviour: a refresh
 * must never silently overwrite renames, hidden flags, or capabilities the
 * user touched. See docs/research/provider-model-discovery.md.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const provider = getProvider(id);
  if (!provider) {
    return NextResponse.json<ErrorResponse>({ error: 'Provider not found' }, { status: 404 });
  }

  const matched = findMatchingPresetForRecord({
    provider_type: provider.provider_type,
    base_url: provider.base_url,
  });
  const authStyle: 'api_key' | 'auth_token' | undefined = (() => {
    const fromPreset = matched?.authStyle;
    if (fromPreset === 'api_key' || fromPreset === 'auth_token') return fromPreset;
    return undefined;
  })();

  const result = await discoverModels({
    protocol: matched?.protocol ?? provider.provider_type ?? 'unknown',
    baseUrl: provider.base_url || '',
    apiKey: provider.api_key || undefined,
    authStyle,
    presetKey: matched?.key,
  });

  // Build the diff against current DB state. Every upstream id gets one of
  // the upstream-side statuses; existing DB rows that don't appear in the
  // upstream this round are emitted as `orphan` so the UI can flag them.
  const dbModels = getAllModelsForProvider(id);
  const dbByModelId = new Map<string, ProviderModel>();
  for (const m of dbModels) dbByModelId.set(m.model_id, m);

  const diff: DiffEntry[] = [];
  const seenInUpstream = new Set<string>();

  if (result.ok && result.sampleModels && result.sampleModels.length > 0) {
    for (const raw of result.sampleModels) {
      const modelId = normalizeModelId(raw);
      seenInUpstream.add(modelId);
      const existing = dbByModelId.get(modelId);
      if (!existing) {
        diff.push({ modelId, upstreamModelId: raw, status: 'new' });
        continue;
      }
      const isHidden = existing.enabled === 0;
      const wasEdited = existing.user_edited === 1;
      const upstreamUnchanged = existing.upstream_model_id === raw && existing.source === 'api';
      let status: DiffEntryStatus;
      if (isHidden) status = 'hidden-but-upstream';
      else if (wasEdited) status = 'preserve-edited';
      else if (upstreamUnchanged) status = 'unchanged';
      else status = 'will-update';

      diff.push({
        modelId,
        upstreamModelId: raw,
        status,
        current: {
          display_name: existing.display_name,
          enabled: existing.enabled,
          user_edited: existing.user_edited,
          source: existing.source,
        },
      });
    }
  }

  // Emit orphans only when the probe succeeded — a failed probe has no
  // negative information to draw conclusions from.
  if (result.ok) {
    for (const m of dbModels) {
      if (!seenInUpstream.has(m.model_id)) {
        diff.push({
          modelId: m.model_id,
          upstreamModelId: m.upstream_model_id,
          status: 'orphan',
          current: {
            display_name: m.display_name,
            enabled: m.enabled,
            user_edited: m.user_edited,
            source: m.source,
          },
        });
      }
    }
  }

  return NextResponse.json({
    providerId: id,
    providerName: provider.name,
    presetKey: matched?.key ?? null,
    classification: result.classification,
    protocol: result.protocol,
    endpoint: result.endpoint,
    ok: result.ok,
    modelCount: result.modelCount,
    sampleModels: result.sampleModels,
    error: result.error,
    notes: result.notes,
    suggestedFallback: result.suggestedFallback,
    durationMs: result.durationMs,
    diff,
  });
}

/**
 * GET — static classification only, no network.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const provider = getProvider(id);
  if (!provider) {
    return NextResponse.json<ErrorResponse>({ error: 'Provider not found' }, { status: 404 });
  }
  const matched = findMatchingPresetForRecord({
    provider_type: provider.provider_type,
    base_url: provider.base_url,
  });
  const c = classifyProvider({
    protocol: matched?.protocol ?? provider.provider_type ?? 'unknown',
    presetKey: matched?.key,
  });
  return NextResponse.json({
    providerId: id,
    providerName: provider.name,
    presetKey: matched?.key ?? null,
    classification: c.classification,
    protocol: c.protocol,
    notes: c.notes,
    suggestedFallback: c.suggestedFallback,
  });
}
