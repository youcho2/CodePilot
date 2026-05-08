import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ProviderModelGroup } from '@/types';
// `chat-runtime-shared` (not `chat-runtime`) — even type-only imports
// from the server-side module muddy the boundary; keeping all hook /
// component imports pointed at the shared module makes "client-safe"
// the local rule for this hook too.
import type { ChatRuntimeParam } from '@/lib/chat-runtime-shared';

// Default Claude model options — used as fallback when API is unavailable
export interface DefaultModelOption {
  value: string;
  label: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
}

export const DEFAULT_MODEL_OPTIONS: DefaultModelOption[] = [
  {
    value: 'sonnet',
    label: 'Sonnet 4.6',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
  },
  {
    value: 'opus',
    label: 'Opus 4.7',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'haiku',
    label: 'Haiku 4.5',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
];

export interface UseProviderModelsReturn {
  providerGroups: ProviderModelGroup[];
  /**
   * The runtime the server actually filtered against, when the hook
   * was called with `runtime: 'auto'`. UI uses this to surface
   * "showing models for X runtime" in the picker. Undefined when
   * caller passed `runtime: null` (Settings full-catalog mode).
   */
  runtimeApplied?: 'claude_code' | 'codepilot_runtime';
  currentProviderIdValue: string;
  modelOptions: typeof DEFAULT_MODEL_OPTIONS;
  currentModelOption: (typeof DEFAULT_MODEL_OPTIONS)[number];
  /** Global default model (model value) */
  globalDefaultModel: string | undefined;
  /** Global default model's provider ID */
  globalDefaultProvider: string | undefined;
  /**
   * True when the runtime-filtered API succeeded but returned an empty
   * group list — user has providers configured but none are compatible
   * with the active runtime. Distinct from "API is unreachable" (the
   * catch branch synthesises an `env` group, so providerGroups.length
   * stays 1 in that case). Callers (chat picker / send-gate) use this
   * to block sends so the saved-session model+provider combo can't reach
   * /api/chat where it would be silently re-resolved against env defaults.
   */
  noCompatibleProvider: boolean;
  /**
   * Load tracking. `loaded` after the first successful response (even
   * with `groups: []`); `failed` after network/parse error (catch branch
   * already synthesised an `env` fallback group); `idle` until the first
   * fetch settles. Callers use this to avoid auto-rewriting saved
   * session state during the load window or when the API is down.
   */
  fetchState: 'idle' | 'loaded' | 'failed';
  /**
   * The provider id the picker / send path SHOULD use right now. Equal
   * to `currentProviderIdValue`; surfaced under a clearer name so
   * consumers don't accidentally use the raw caller-supplied prop when
   * the runtime filter has rerouted to a fallback group. Empty
   * `providerId` is normalised to `'env'` so historic env-mode sessions
   * (provider_id='') flow through the same code path as everyone else.
   */
  resolvedProviderId: string;
  /**
   * The model id the picker / send path SHOULD use. If the caller's
   * `modelName` exists in `modelOptions` it passes through unchanged;
   * otherwise we drop to `modelOptions[0]?.value` so we never send a
   * model the resolved provider doesn't actually expose. Empty when
   * `noCompatibleProvider` (caller must gate before sending).
   */
  resolvedModel: string;
  /**
   * True when the caller-supplied `providerId` was non-empty AND not
   * present in the runtime-filtered groups, i.e. the session's saved
   * provider was filtered out and we substituted a different one.
   * Caller should PATCH /api/chat/sessions/:id with the resolved pair
   * to keep DB / UI / wire-format consistent.
   *
   * Only meaningful after `fetchState === 'loaded'` — during loading
   * and on API failure we don't want to silently rewrite saved state.
   */
  providerWasFilteredOut: boolean;
}

/**
 * @param runtime  Runtime gate for the picker feed. **Required as of
 * Phase 2 Step 3b** — the previous `'auto'` default made every chat-side
 * caller silently re-filter on global `agent_runtime` change, so any
 * open chat could "lose" its provider when the user flipped Settings.
 * Callers must now choose deliberately:
 *   - `'auto'`: server resolves the active runtime via global setting
 *     and filters. **Only** appropriate for new-chat / Settings flows
 *     where there is no session intent yet.
 *   - `'claude_code'` / `'codepilot_runtime'`: explicit pin. The chat
 *     view computes this from the session's `runtime_pin` via
 *     `chatRuntimeParamForSession()`, so the picker reflects what THIS
 *     session can actually reach — global flips don't cascade.
 *   - `null`: skip the filter entirely — full catalog (e.g. Settings >
 *     Providers' global default-model selector).
 */
export function useProviderModels(
  providerId: string | undefined,
  modelName: string | undefined,
  runtime: ChatRuntimeParam | null,
): UseProviderModelsReturn {
  const [providerGroups, setProviderGroups] = useState<ProviderModelGroup[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string>('');
  const [globalDefaultModel, setGlobalDefaultModel] = useState<string | undefined>();
  const [globalDefaultProvider, setGlobalDefaultProvider] = useState<string | undefined>();
  const [runtimeApplied, setRuntimeApplied] = useState<'claude_code' | 'codepilot_runtime' | undefined>(undefined);
  // Tri-state load tracking. `noCompatibleProvider` is meaningful only
  // after a successful response — the initial empty `providerGroups`
  // array is NOT a "no compatible provider" signal, it's just "fetch
  // hasn't returned yet". Without this, mounting a chat session would
  // briefly disable the composer (and let auto-trigger / retry paths
  // swallow sends) before the runtime-filtered feed even arrives.
  const [fetchState, setFetchState] = useState<'idle' | 'loaded' | 'failed'>('idle');
  // Tracks the in-flight provider/options fetch so a later refetch
  // (provider-changed event, runtime switch) can abort the previous
  // pair before starting its own. Without this, a slow earlier
  // response could land after a newer one and silently re-open the
  // runtime gate against stale groups.
  const fetchControllerRef = useRef<AbortController | null>(null);

  const fetchAll = useCallback(() => {
    // Abort any in-flight pair from a previous fetchAll() so its late
    // response can't land after we've moved on. Each call gets its own
    // controller; only the most recent call's resolved/failed branches
    // are allowed to mutate state.
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    const signal = controller.signal;

    const url = runtime
      ? `/api/providers/models?runtime=${encodeURIComponent(runtime)}`
      : '/api/providers/models';
    // Reset fetchState to idle on every (re)fetch — a `provider-changed`
    // event mid-session would otherwise leave fetchState='loaded' with
    // stale providerGroups, letting send / auto-trigger paths use the
    // old runtime-filtered feed during the refresh window. Forcing idle
    // re-engages ChatView's idle gate until the new response settles.
    setFetchState('idle');
    // Two distinct outcomes here, treated differently:
    //   1. Network / parse failure → fall back to a synthetic `env` group
    //      with built-in Claude defaults so the picker isn't completely
    //      empty when the API is unreachable.
    //   2. Success but `groups: []` → keep the picker empty. With a
    //      runtime filter applied, an empty array is a meaningful state
    //      ("user has no provider compatible with the active runtime");
    //      synthesizing `env` + sonnet/opus/haiku here would smuggle the
    //      Claude defaults back past the runtime gate the server just
    //      enforced. Caller should render a "please configure / switch
    //      runtime" empty state.
    fetch(url, { signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (signal.aborted) return; // superseded by newer fetchAll
        if (data && Array.isArray(data.groups)) {
          setProviderGroups(data.groups);
          setDefaultProviderId(data.default_provider_id || '');
          setRuntimeApplied(data.runtime_applied || undefined);
          setFetchState('loaded');
        } else {
          // Malformed response — same handling as a network failure.
          throw new Error('Malformed /api/providers/models response');
        }
      })
      .catch((err) => {
        // Aborted by a newer fetchAll — leave state alone, the newer
        // call owns the next setProviderGroups / setFetchState write.
        if (err?.name === 'AbortError' || signal.aborted) return;
        setProviderGroups([{
          provider_id: 'env',
          provider_name: 'Anthropic',
          provider_type: 'anthropic',
          models: DEFAULT_MODEL_OPTIONS,
        }]);
        setDefaultProviderId('');
        setFetchState('failed');
      });

    // Fetch global default model — same abort discipline so its late
    // response doesn't bleed into a subsequent fetchAll's window.
    fetch('/api/providers/options?providerId=__global__', { signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (signal.aborted) return;
        setGlobalDefaultModel(data?.options?.default_model || undefined);
        setGlobalDefaultProvider(data?.options?.default_model_provider || undefined);
      })
      .catch(() => { /* aborted or network — silent best-effort */ });
  }, [runtime]);

  // Load on mount and listen for provider changes.
  // fetchAll's first line is `setFetchState('idle')` to gate refetches —
  // a lint rule flags the synchronous setState as a potential cascading
  // render, but the set is intentional: mount/refetch must reset the
  // load gate before the new request resolves. The follow-up setState
  // calls happen inside async then/catch (off the render path), so
  // there's no actual cascade.
  /* eslint-disable */
  useEffect(() => {
    fetchAll();
    const handler = () => fetchAll();
    window.addEventListener('provider-changed', handler);
    return () => {
      window.removeEventListener('provider-changed', handler);
      // Abort any in-flight request when the consumer unmounts so it
      // can't try to setState on a torn-down component.
      fetchControllerRef.current?.abort();
      fetchControllerRef.current = null;
    };
  }, [fetchAll]);
  /* eslint-enable */

  // Two layers of provider id resolution:
  //
  // requestedProviderId — the *semantic* id the caller actually wants
  //   us to route to. Preserves "user picked env" intent even when env
  //   isn't in the current runtime feed. Used by `providerWasFilteredOut`
  //   so a session whose desired provider got replaced by a fallback
  //   gets PATCHed back to a consistent state.
  //
  // preferredProviderId — what we look up in `providerGroups` for the
  //   group / model-options derivation. May resolve to `groups[0]` when
  //   the requested id can't be served by the current feed (env filtered
  //   out under CodePilot Runtime, etc.).
  //
  // Both layers keep `undefined` and `''` distinct: undefined means
  // "caller didn't supply — use the global default chain"; '' is the
  // historic env-mode session value that must NOT be hijacked by
  // globalDefaultProvider.
  let requestedProviderId: string | undefined;
  let preferredProviderId: string;
  if (providerId === undefined) {
    requestedProviderId = undefined;
    preferredProviderId =
      globalDefaultProvider || defaultProviderId || (providerGroups[0]?.provider_id ?? '');
  } else if (providerId === '') {
    // Historic env-mode session: provider_id stored as '' in DB.
    // Semantically the user wants 'env'; surface that as the request
    // even when the env group is filtered out, so the comparison
    // against `resolvedProviderId` correctly flags substitution.
    requestedProviderId = 'env';
    preferredProviderId = providerGroups.some(g => g.provider_id === 'env')
      ? 'env'
      : (providerGroups[0]?.provider_id ?? '');
  } else {
    requestedProviderId = providerId;
    preferredProviderId = providerId;
  }
  // Resolve provider id and group atomically. The preferred id comes from
  // the prop / global default / DB default chain, but the active runtime
  // may have filtered the preferred provider out of `providerGroups`
  // (server-side `?runtime=` drops empty groups). When that happens we
  // MUST report a provider id that actually exists in the picker — if we
  // returned the now-missing preferred id alongside `modelOptions` from
  // the fallback group, MessageInput's auto-correct would write back
  // `(stale provider, fallback model)` and re-introduce the cross-wire
  // we just spent the day fixing.
  const matchedGroup = providerGroups.find(g => g.provider_id === preferredProviderId);
  const currentGroup = matchedGroup ?? providerGroups[0];
  // currentProviderIdValue tracks currentGroup. If the preferred id was
  // filtered out, this surfaces a runtime-compatible fallback id so the
  // picker has *something* live to render. **The hook does NOT persist
  // this back to the session** — Phase 2 Step 3b removed the silent
  // PATCH effect in ChatView that used to do that. Persistence now
  // requires an explicit user action through `onProviderModelChange`
  // (model picker), which is why the caller pairs this value with the
  // `providerWasFilteredOut` signal below to surface an inline notice
  // and gate send.
  const currentProviderIdValue = currentGroup?.provider_id ?? preferredProviderId;
  // DEFAULT_MODEL_OPTIONS (sonnet/opus/haiku) is reserved for the env
  // provider only — when the user is genuinely on the built-in Claude
  // Code path, the picker shows the canonical short aliases.
  //
  // We deliberately do NOT fall back to defaults on `providerGroups.length === 0`
  // anymore: with the API-failure path now synthesizing an `env` group in
  // the catch branch above, an *empty* providerGroups array reaching here
  // means the runtime filter legitimately matched nothing. Synthesising
  // Claude defaults would re-introduce the cross-wire (e.g. CodePilot
  // Runtime user with no compatible provider sees `sonnet` and sends a
  // chat request that the server then resolves against `env` defaults,
  // bypassing the runtime gate the API just enforced).
  const allowDefaultFallback = currentProviderIdValue === 'env';
  const modelOptions = (currentGroup?.models && currentGroup.models.length > 0)
    ? currentGroup.models
    : (allowDefaultFallback ? DEFAULT_MODEL_OPTIONS : []);

  const currentModelValue = modelName || 'sonnet';
  const currentModelOption = useMemo(
    () => modelOptions.find((m) => m.value === currentModelValue) || modelOptions[0],
    [modelOptions, currentModelValue],
  );

  // Resolved pair contract — single source of truth for "what should the
  // picker / send path actually use right now".
  //
  // resolvedModel: prefer caller's modelName when it's actually exposed
  //   by the resolved group; otherwise drop to the group's first model.
  //   Empty when the group has zero models (caller must gate via
  //   noCompatibleProvider before sending).
  const resolvedProviderId = currentProviderIdValue;
  const resolvedModel = (modelName && modelOptions.some(m => m.value === modelName))
    ? modelName
    : (modelOptions[0]?.value ?? '');
  // providerWasFilteredOut: did the runtime-filtered feed force us to
  // route somewhere different from what the caller semantically
  // requested? Compare requestedProviderId (semantic intent) NOT
  // preferredProviderId (which already absorbs the env→groups[0]
  // fallback). The flag is purely informational — the hook does not
  // act on it. Phase 2 Step 3b: the consumer (ChatView) reads this to
  // render an inline notice and disable send until the user picks a
  // new provider via the picker; persistence to the session row is
  // gated behind that explicit user action, never silent. Skipped
  // during load / failure so consumers don't act on an unreliable view.
  const providerWasFilteredOut = fetchState === 'loaded'
    && requestedProviderId !== undefined
    && requestedProviderId !== resolvedProviderId;

  return {
    providerGroups,
    runtimeApplied,
    currentProviderIdValue,
    modelOptions,
    currentModelOption,
    globalDefaultModel,
    globalDefaultProvider,
    // The hook only sets providerGroups to an empty array when the fetch
    // returns 200 with `groups: []` (runtime-filtered no-match). API
    // failures synthesise an `env` group in the catch branch, so
    // length === 0 is a precise "no compatible provider" signal — but
    // ONLY after the initial fetch settles. Before that, an empty list
    // just means "loading"; reporting noCompatibleProvider=true during
    // the load window would briefly disable composer / swallow auto-
    // triggered sends.
    noCompatibleProvider: fetchState === 'loaded' && providerGroups.length === 0,
    fetchState,
    resolvedProviderId,
    resolvedModel,
    providerWasFilteredOut,
  };
}
