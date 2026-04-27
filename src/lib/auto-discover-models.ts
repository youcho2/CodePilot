/**
 * runAutoDiscoverForProvider — silent probe → apply → toast for one provider.
 *
 * Extracted so both the Add Service success path (`ProviderManager.handlePresetAdd`)
 * and the Models page per-provider "刷新模型" button can share the same flow.
 *
 * Behavior:
 *   - probe `/api/providers/[id]/discover-models`
 *   - filter to writeable diff buckets (new / will-update / preserve-edited /
 *     hidden-but-upstream)
 *   - POST to `/discover-models/apply` with the filtered list
 *   - update one toast through loading → success/warning/info
 *   - dispatch `provider-changed` so listeners refetch (Models page row list,
 *     Provider card stats, etc.)
 *
 * Failure modes degrade silently — provider state is intact, user can retry.
 * No diff-preview UI is shown; that's the dedicated `handleDiscoverModels`
 * dialog flow in ProviderManager. This helper is the "I trust the conservative
 * apply policy, just do it" path.
 */

import { showToast, updateToast } from '@/hooks/useToast';
import type { TranslationKey } from '@/i18n';

interface AutoDiscoverArgs {
  providerId: string;
  providerName: string;
  /** Translator from useTranslation(). Caller passes its bound `t`. */
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

interface DiscoverProbeResponse {
  ok?: boolean;
  modelCount?: number;
  diff?: { modelId: string; upstreamModelId: string; status: string }[];
  classification?: string;
  error?: { message?: string };
}

interface ApplyStatsResponse {
  inserted: number;
  refreshedPristine: number;
  recommendedEnabled: number;
  discoveredHidden: number;
}

/**
 * Returns void — outcomes are surfaced via toast + the global
 * `provider-changed` event. Callers should await the returned promise
 * if they need to await UI settle, but most fire-and-forget.
 */
export async function runAutoDiscoverForProvider({
  providerId,
  providerName,
  t,
}: AutoDiscoverArgs): Promise<void> {
  const loadingToastId = showToast({
    type: 'loading',
    message: t('provider.autoDiscover.loading' as TranslationKey, { name: providerName }),
    duration: 0,
  });

  try {
    const probeRes = await fetch(`/api/providers/${providerId}/discover-models`, { method: 'POST' });
    if (!probeRes.ok) {
      updateToast(loadingToastId, {
        type: 'warning',
        message: t('provider.autoDiscover.probeFailed' as TranslationKey, { name: providerName }),
        duration: 5000,
      });
      return;
    }
    const probe = await probeRes.json() as DiscoverProbeResponse;

    if (!probe.ok) {
      updateToast(loadingToastId, {
        type: 'warning',
        message: probe.classification === 'unsupported'
          ? t('provider.autoDiscover.unsupported' as TranslationKey, { name: providerName })
          : t('provider.autoDiscover.probeFailed' as TranslationKey, { name: providerName }),
        duration: 5000,
      });
      return;
    }

    // Same filter as the manual diff dialog — only buckets that result
    // in a write are forwarded to apply.
    const applicable = (probe.diff || []).filter((e) =>
      e.status === 'new'
      || e.status === 'will-update'
      || e.status === 'preserve-edited'
      || e.status === 'hidden-but-upstream',
    );

    if (applicable.length === 0) {
      updateToast(loadingToastId, {
        type: 'info',
        message: t('provider.autoDiscover.noModels' as TranslationKey, { name: providerName }),
        duration: 5000,
      });
      return;
    }

    const applyRes = await fetch(`/api/providers/${providerId}/discover-models/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstreamModels: applicable.map((e) => ({ modelId: e.modelId, upstreamModelId: e.upstreamModelId })),
      }),
    });
    if (!applyRes.ok) {
      updateToast(loadingToastId, {
        type: 'warning',
        message: t('provider.autoDiscover.applyFailed' as TranslationKey, { name: providerName }),
        duration: 5000,
      });
      return;
    }
    const stats = await applyRes.json() as ApplyStatsResponse;

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('provider-changed'));
    }

    const total = probe.modelCount ?? applicable.length;
    updateToast(loadingToastId, {
      type: 'success',
      message: t('provider.autoDiscover.success' as TranslationKey, {
        name: providerName,
        total: String(total),
        enabled: String(stats.recommendedEnabled),
        hidden: String(stats.discoveredHidden),
      }),
      duration: 6000,
    });
  } catch (err) {
    updateToast(loadingToastId, {
      type: 'warning',
      message: err instanceof Error
        ? `${providerName}: ${err.message}`
        : t('provider.autoDiscover.probeFailed' as TranslationKey, { name: providerName }),
      duration: 5000,
    });
  }
}
