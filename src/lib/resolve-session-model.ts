/**
 * Resolve the effective model and provider for a session.
 *
 * Priority:
 * 1. Session's stored model (if non-empty)
 * 2. Global default model (from server settings)
 * 3. First available model within the session's provider (if provider is set but model isn't)
 * 4. localStorage last-used model (cross-session fallback)
 * 5. 'sonnet' hardcoded fallback
 *
 * The session's provider_id is preserved when possible — we only override it
 * when the session has neither model nor provider stored.
 */
export async function resolveSessionModel(
  sessionModel: string,
  sessionProviderId: string,
): Promise<{ model: string; providerId: string }> {
  // Session already has a model — use it as-is
  if (sessionModel) {
    return { model: sessionModel, providerId: sessionProviderId };
  }

  // No model stored — try global default first
  try {
    const globalRes = await fetch('/api/providers/options?providerId=__global__');
    if (globalRes.ok) {
      const globalData = await globalRes.json();
      const gm = globalData?.options?.default_model;
      const gp = globalData?.options?.default_model_provider;

      if (gm) {
        // Use global default model. Only override provider if session has none.
        return {
          model: gm,
          providerId: sessionProviderId || gp || '',
        };
      }
    }
  } catch { /* best effort */ }

  // No global default — if session has a provider, pick its first available model
  if (sessionProviderId) {
    try {
      const modelsRes = await fetch('/api/providers/models');
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        const groups = data?.groups as Array<{ provider_id: string; models: Array<{ value: string }> }> | undefined;
        const group = groups?.find(g => g.provider_id === sessionProviderId);
        if (group?.models?.length) {
          return { model: group.models[0].value, providerId: sessionProviderId };
        }
      }
    } catch { /* best effort */ }
  }

  // Final fallback: localStorage last-used
  const lsModel = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') : null;
  const lsProvider = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') : null;
  return {
    model: lsModel || 'sonnet',
    providerId: lsProvider || '',
  };
}
