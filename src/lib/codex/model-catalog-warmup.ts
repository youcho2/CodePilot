/**
 * Non-blocking client warm-up for the Codex Account model catalog.
 *
 * The unified `/api/providers/models` endpoint intentionally uses a
 * cache-only Codex read for full-catalog requests. That keeps a broken or
 * slow app-server from freezing every other provider, but it also means a
 * cold renderer needs one explicit, bounded Codex discovery request before
 * the unified feed can include `codex_account`.
 *
 * Calls share one in-flight promise (ChatView and MessageInput both mount
 * model hooks). A successful discovery emits a narrow event so only model
 * feed consumers refetch; warming a read-only catalog is not a provider
 * mutation and must not fan out through `provider-changed`.
 */

export const CODEX_MODEL_CATALOG_READY_EVENT = 'codepilot:codex-model-catalog-ready';

type FetchLike = (
  input: string,
  init?: { cache?: RequestCache },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

type EmitReady = () => void;

let activeWarmup: Promise<void> | null = null;
let catalogReady = false;
let catalogGeneration = 0;

function defaultEmitReady(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CODEX_MODEL_CATALOG_READY_EVENT));
}

/**
 * Warm the server-side Codex model cache without delaying the normal provider
 * feed. Failures and logged-out responses are intentionally silent: the
 * existing Codex status UI remains the source of diagnostic detail.
 */
export function warmCodexModelCatalog(
  fetchImpl: FetchLike = fetch,
  emitReady: EmitReady = defaultEmitReady,
): Promise<void> {
  if (catalogReady) return Promise.resolve();
  if (activeWarmup) return activeWarmup;

  const generation = catalogGeneration;
  const warmup = fetchImpl('/api/codex/models', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as {
        group?: { models?: unknown[] } | null;
      } | null;
      if (
        generation === catalogGeneration
        && body?.group
        && Array.isArray(body.group.models)
        && body.group.models.length > 0
      ) {
        catalogReady = true;
        emitReady();
      }
    })
    .catch(() => {
      // Best-effort warm-up. The base provider feed must remain usable when
      // Codex is logged out, unavailable, or still starting.
    })
    .finally(() => {
      if (activeWarmup === warmup) activeWarmup = null;
    });

  activeWarmup = warmup;
  return warmup;
}

/**
 * Invalidate the renderer-side success memo after a real provider/account
 * mutation. The generation prevents a stale in-flight response from marking
 * the new account state ready or emitting a misleading refresh.
 */
export function invalidateCodexModelCatalogWarmup(): void {
  catalogGeneration += 1;
  catalogReady = false;
  activeWarmup = null;
}

/** Test alias documenting deterministic state reset intent. */
export const resetCodexModelCatalogWarmupForTests = invalidateCodexModelCatalogWarmup;
