/**
 * claude-model-options.ts — shared model-option sanitizer for Claude models.
 *
 * The Claude Agent SDK path (claude-client.ts) and the native/AI-SDK path
 * (agent-loop.ts) both assemble thinking / effort / context1m options for
 * Anthropic requests. Without a shared sanitizer, breaking-change guards
 * have to be duplicated across paths and drift (which is exactly what Codex
 * flagged in the Opus 4.7 review).
 *
 * Scope for the Opus 4.7+ adaptive-thinking family (4.7, 4.8, and Fable 5,
 * per the official migration guides — they share the same request contract;
 * Fable 5 additionally rejects an explicit thinking:disabled, see below):
 *   - These models do NOT accept manual extended thinking
 *     ({ type: 'enabled', budgetTokens }) — returns 400. Convert to adaptive.
 *   - They support adaptive thinking + effort-based reasoning budget.
 *     (Display=summarized can be added by callers separately.)
 *   - 1M context is the default — context-1m-2025-08-07 beta header is
 *     unnecessary and gets skipped.
 *
 * NOTE on effort DEFAULT (4.7 → xhigh, 4.8 → high): that per-model default
 * is applied by the Claude Code CLI / SDK when `effort` is left unset (see
 * claude-client.ts ~1193), NOT here. This sanitizer only normalizes thinking
 * + the context-1m beta; it passes `effort` through untouched.
 */

export type ThinkingConfig =
  | { type: 'adaptive'; display?: 'summarized' | 'omitted' }
  | { type: 'enabled'; budgetTokens?: number; display?: 'summarized' | 'omitted' }
  | { type: 'disabled' };

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ClaudeModelOptionsInput {
  /** Upstream / full model ID (e.g. 'claude-opus-4-7'). Short aliases like
   *  'opus' are not detected as 4.7 — callers should resolve to upstream
   *  before sanitizing. */
  model: string | undefined;
  thinking?: ThinkingConfig;
  effort?: EffortLevel | string;
  context1m?: boolean;
}

export interface ClaudeModelOptionsOutput {
  thinking?: ThinkingConfig;
  effort?: string;
  /** After sanitization, whether the caller should attach the
   *  context-1m-2025-08-07 beta header. Opus 4.7 is 1M by default and
   *  returns true only for models that still need the beta. */
  applyContext1mBeta: boolean;
  /** Whether the input model is in the Opus 4.7+ adaptive-thinking family
   *  (4.7 / 4.8). Exposed so callers can log or make additional
   *  runtime-specific decisions. */
  isOpusAdaptiveThinking: boolean;
}

// Opus 4.7 and 4.8 share the adaptive-thinking contract (no manual extended
// thinking; 1M context by default). Add future same-family versions to the
// `[78]` character class. Matches BOTH the dash upstream (`claude-opus-4-8`,
// first-party) and the dotted slug (`anthropic/claude-opus-4.8`, OpenRouter):
// OpenRouter currently routes via the OpenAI SDK, but a future Anthropic-skin
// / provider override could send the dotted form here, so we don't rely on
// that assumption (Codex review P2, 2026-05-29).
const OPUS_ADAPTIVE_THINKING_PATTERN = /opus-?4[-.]?[78]/i;

// Fable 5 (claude-fable-5, 2026-06 launch) shares the Opus 4.7/4.8 request
// contract (adaptive thinking only; sampling params removed; 1M default)
// with ONE extra breaking change per the official model docs: an explicit
// `thinking: { type: 'disabled' }` returns 400 (it is accepted on 4.7/4.8) —
// the param must be omitted entirely instead. Matches `claude-fable-5`,
// `fable-5`, and tagged variants like `claude-fable-5[1m]`.
const FABLE_PATTERN = /fable-?5/i;

export function isFableModel(model: string | undefined): boolean {
  if (!model) return false;
  return FABLE_PATTERN.test(model);
}

export function isOpusAdaptiveThinkingModel(model: string | undefined): boolean {
  if (!model) return false;
  // Fable 5 is in the same adaptive-thinking family — every 4.7+ guard
  // (enabled→adaptive conversion, no context-1m beta) applies to it too.
  return OPUS_ADAPTIVE_THINKING_PATTERN.test(model) || FABLE_PATTERN.test(model);
}

/**
 * Normalize thinking / effort / context1m for a single Anthropic request.
 * Idempotent — safe to call multiple times on the same input.
 */
export function sanitizeClaudeModelOptions(
  input: ClaudeModelOptionsInput,
): ClaudeModelOptionsOutput {
  const isOpusAdaptiveThinking = isOpusAdaptiveThinkingModel(input.model);

  let thinking = input.thinking;
  if (isOpusAdaptiveThinking && thinking) {
    // Opus 4.7+ reject manual extended thinking. Convert to adaptive so
    // the user's "thinking enabled" intent survives without triggering
    // a 400.
    if (thinking.type === 'enabled') {
      thinking = { type: 'adaptive', display: 'summarized' };
    } else if (thinking.type === 'adaptive' && !thinking.display) {
      // Adaptive thinking defaults display to 'omitted', which means the
      // SDK will not emit thinking deltas and CodePilot's reasoning block
      // disappears. Explicitly request 'summarized' so users still see the
      // reasoning UI they saw on 4.6.
      thinking = { ...thinking, display: 'summarized' };
    } else if (thinking.type === 'disabled' && isFableModel(input.model)) {
      // Fable 5 rejects an explicit { type: 'disabled' } with a 400
      // (4.7/4.8 accept it). Omitting the param has the same semantics
      // (thinking off), so drop it instead of forwarding.
      thinking = undefined;
    }
  }

  // Opus 4.7+ ship 1M by default — the beta header is unnecessary and
  // kept out to make regression hunting cleaner.
  const applyContext1mBeta = !!input.context1m && !isOpusAdaptiveThinking;

  return {
    thinking,
    effort: input.effort as string | undefined,
    applyContext1mBeta,
    isOpusAdaptiveThinking,
  };
}
