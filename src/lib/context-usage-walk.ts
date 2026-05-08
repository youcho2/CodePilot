/**
 * context-usage-walk.ts — pure helper that walks an assistant message
 * list backwards and resolves the `used` baseline + `contextWindow`
 * for `useContextUsage`.
 *
 * Lives outside the React hook so the picking logic is unit-testable
 * without a React renderer. The hook stays a thin wrapper that adds
 * the snapshot fast-path and `useMemo` plumbing.
 *
 * Two non-obvious rules anchored here (both with regression history,
 * see commit messages 2026-05-08):
 *
 *   1. Output-only / all-zero records can't drive the `used` baseline
 *      — the latest tail accounting record sometimes carries
 *      `{input_tokens:0, cache_*:0, output_tokens:N}` and treating
 *      `used = 0` zeros the context bar even though the prior turn's
 *      input + cache is still pinned in the conversation. Walk past
 *      those records when picking baseline.
 *
 *   2. The `context_window` on those skipped records IS still
 *      authoritative — the SDK populates it on every result, not just
 *      on input-bearing turns. Capture the newest positive
 *      `context_window` we see during the walk and use it as a
 *      fallback when the resolved baseline doesn't carry its own.
 *      This is what keeps GLM / Bailian / MiniMax / Kimi / Volcengine
 *      / DeepSeek (models the catalog doesn't enumerate) out of
 *      "capacity unknown."
 */

export interface MinimalMessageForUsage {
  role: 'user' | 'assistant' | string;
  token_usage?: string | object | null;
}

export interface ContextWalkResult {
  /** Assistant turn whose input + cache reflects the current baseline.
   *  Null when no meaningful baseline exists yet. */
  baseline: {
    used: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
    /** Window the SDK reported on the BASELINE record itself, if any. */
    sdkContextWindow: number | null;
  } | null;
  /** Newest positive `context_window` seen anywhere in the walk —
   *  including output-only / all-zero records the baseline-finder
   *  skipped. Null when no record carried one. */
  latestSdkContextWindow: number | null;
}

/**
 * Walk messages from the end and produce baseline + the latest SDK
 * context window. Pure — no I/O, no React.
 */
export function walkContextUsage(messages: readonly MinimalMessageForUsage[]): ContextWalkResult {
  let latestSdkContextWindow: number | null = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.token_usage) continue;

    let usage: Record<string, unknown>;
    try {
      usage = (typeof msg.token_usage === 'string'
        ? JSON.parse(msg.token_usage)
        : msg.token_usage) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!usage || typeof usage !== 'object') continue;

    const inputTokens = (usage.input_tokens as number) || 0;
    const cacheRead = (usage.cache_read_input_tokens as number) || 0;
    const cacheCreation = (usage.cache_creation_input_tokens as number) || 0;
    const outputTokens = (usage.output_tokens as number) || 0;
    const used = inputTokens + cacheRead + cacheCreation;

    // Capture context_window from THIS record before deciding to skip.
    // Newest wins; once set, later (older) iterations don't overwrite.
    const ctxWindowField = usage.context_window;
    if (
      latestSdkContextWindow === null
      && typeof ctxWindowField === 'number'
      && ctxWindowField > 0
    ) {
      latestSdkContextWindow = ctxWindowField;
    }

    // Skip output-only and all-zero records for the baseline.
    if (used === 0 && outputTokens > 0) continue;
    if (used === 0 && outputTokens === 0) continue;

    const baselineSdkContextWindow = typeof ctxWindowField === 'number' && ctxWindowField > 0
      ? ctxWindowField
      : null;

    return {
      baseline: {
        used,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
        outputTokens,
        sdkContextWindow: baselineSdkContextWindow,
      },
      latestSdkContextWindow,
    };
  }

  return { baseline: null, latestSdkContextWindow };
}
