/**
 * agent-loop-anthropic-wire.ts — build the Anthropic `providerOptions` wire
 * object for the native Agent Loop.
 *
 * Extracted from agent-loop.ts's inline step loop (model plan Phase 2 / s05,
 * 2026-07-18) following the same convention as agent-loop-error-event.ts /
 * agent-loop-tool-error.ts: the wire-shaping logic lives in its own dependency-
 * free module so it is unit-testable directly (no DB / provider imports pulled
 * in). The object returned here is the SAME one assigned to `providerOptions`
 * and handed to `streamText({ providerOptions })` — asserting on it is asserting
 * on the real request shape, not a source-text grep.
 */

import { anthropicApiSupportsEffort, type ClaudeModelOptionsOutput } from './claude-model-options';

/**
 * Result of {@link buildAnthropicProviderOptions}: the exact `anthropic`
 * provider-options object that gets handed to `streamText({ providerOptions })`
 * (or `undefined` when nothing needs sending), plus whether an explicit effort
 * was dropped on a third-party proxy so the caller can emit the one-shot
 * RUNTIME_EFFORT_IGNORED notice.
 */
export interface AnthropicWireOptions {
  /** `providerOptions.anthropic` for streamText, or undefined if empty. */
  anthropic: Record<string, unknown> | undefined;
  /** True when a user-picked effort was NOT sent because the target is a
   *  third-party Anthropic proxy (may not accept the field). */
  effortDroppedForProxy: boolean;
  /** True when a user-picked effort was NOT sent on the OFFICIAL Anthropic
   *  path because the resolved model isn't on Anthropic's effort-capable list
   *  (`anthropicApiSupportsEffort`) — e.g. Haiku 4.5 or an unknown model.
   *  Callers MUST surface this once (RUNTIME_EFFORT_IGNORED); the composer
   *  still offers an Effort picker for models whose catalog entry declares
   *  SDK-level effort, so an unannounced omission would silently misrepresent
   *  the pick. Mutually exclusive with `effortDroppedForProxy`. */
  effortDroppedUnsupportedModel: boolean;
}

/**
 * Build the Anthropic `providerOptions` from sanitized model options.
 *
 * Effort policy on the official Anthropic path is PER MODEL, not blanket:
 * @ai-sdk/anthropic 4.0.5 ships effort via GA `output_config.effort` with no
 * effort beta header, so the old "drop effort for the whole adaptive family"
 * workaround is dead — but the API only accepts the field for the models on
 * Anthropic's effort list (`anthropicApiSupportsEffort`). Supported models
 * (Sonnet 5 / Fable 5 / Opus 4.7 / 4.8) get the composer's pick on the wire
 * (the plan's "four-way consistency" gate) with no toast, since that matches
 * real behavior. Unsupported or unknown models (e.g. Haiku 4.5) omit effort and
 * set `effortDroppedUnsupportedModel` so the caller notifies once — sending it
 * anyway is an unsupported request shape (Codex review P1, 2026-07-18:
 * haiku 4.5 + max was reaching the wire as {"effort":"max"}).
 *
 * Third-party proxies drop effort regardless of model (may not accept the
 * field) and set `effortDroppedForProxy` so the caller notifies once.
 */
export function buildAnthropicProviderOptions(args: {
  isThirdPartyProxy: boolean;
  /** Resolved upstream model ID (e.g. 'claude-sonnet-5'). Aliases like 'sonnet'
   *  are not on the effort list and fail closed to "unsupported" — callers
   *  should resolve to upstream before building the wire. */
  model: string | undefined;
  sanitized: Pick<ClaudeModelOptionsOutput, 'thinking' | 'effort' | 'applyContext1mBeta'>;
}): AnthropicWireOptions {
  const { isThirdPartyProxy, model, sanitized } = args;
  const anthropicOpts: Record<string, unknown> = {};
  let effortDroppedForProxy = false;
  let effortDroppedUnsupportedModel = false;

  if (isThirdPartyProxy) {
    // Proxies: only pass thinking if explicitly enabled (not adaptive), skip
    // effort (requires beta header proxies may not support). UI still shows the
    // Effort selector for these providers (supportsEffort is a model-level
    // catalog flag, not per provider-runtime), so an explicit pick silently
    // evaporates — flag it so the caller surfaces a one-shot toast.
    if (sanitized.thinking && sanitized.thinking.type === 'enabled') {
      anthropicOpts.thinking = sanitized.thinking;
    }
    if (sanitized.effort) {
      effortDroppedForProxy = true;
    }
    // Don't pass effort or adaptive thinking for proxies.
  } else {
    // Official API: pass through sanitized thinking, and effort ONLY for models
    // on Anthropic's effort list (see JSDoc above). UI selection == wire for
    // supported models; unsupported/unknown models omit + raise the drop signal.
    if (sanitized.thinking) {
      anthropicOpts.thinking = sanitized.thinking;
    }
    if (sanitized.effort) {
      if (anthropicApiSupportsEffort(model)) {
        anthropicOpts.effort = sanitized.effort;
      } else {
        effortDroppedUnsupportedModel = true;
      }
    }
  }

  if (sanitized.applyContext1mBeta) {
    anthropicOpts.anthropicBeta = ['context-1m-2025-08-07'];
  }

  return {
    anthropic: Object.keys(anthropicOpts).length > 0 ? anthropicOpts : undefined,
    effortDroppedForProxy,
    effortDroppedUnsupportedModel,
  };
}
