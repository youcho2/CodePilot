/**
 * claude-model-options.ts — shared model-option sanitizer for Claude models.
 *
 * The Claude Agent SDK path (claude-client.ts) and the native/AI-SDK path
 * (agent-loop.ts) both assemble thinking / effort / context1m options for
 * Anthropic requests. Without a shared sanitizer, breaking-change guards
 * have to be duplicated across paths and drift (which is exactly what Codex
 * flagged in the Opus 4.7 review).
 *
 * Scope for the Opus 4.7+ adaptive-thinking family (4.7, 4.8, Fable 5, and
 * Sonnet 5, per the official migration guides — they share the same request
 * contract; Fable 5 additionally cannot turn thinking off AT ALL — adaptive
 * thinking runs even when the param is omitted; see FABLE_PATTERN note below.
 * Sonnet 5 is the opposite on that one axis — thinking CAN be turned off, see
 * SONNET_5_PATTERN note):
 *   - These models do NOT accept manual extended thinking
 *     ({ type: 'enabled', budgetTokens }) — returns 400. Convert to adaptive.
 *   - They support adaptive thinking + effort-based reasoning budget.
 *     (Display=summarized can be added by callers separately.)
 *   - 1M context is the default — context-1m-2025-08-07 beta header is
 *     unnecessary and gets skipped.
 *   - Non-default sampling params (temperature / top_p / top_k) 400 on the
 *     adaptive family (official Sonnet 5 / Fable 5 docs). CodePilot's current
 *     callers don't assemble sampling params for Anthropic requests (grep:
 *     agent-loop.ts / claude-client.ts carry no temperature / topP / topK), but
 *     "safe by construction" is one refactor away from a silent 400. So this
 *     sanitizer now ACTIVELY enforces the contract: pass any temperature/topP/
 *     topK you have through the input, and for the adaptive family non-default
 *     values are stripped from `sampling` and their names reported in
 *     `strippedSamplingParams` so the caller can tell the user (same
 *     surface-don't-swallow rule as `thinkingForcedOn`). Non-adaptive models
 *     (e.g. Sonnet 4.6) pass sampling through untouched — the guard must not
 *     misfire on them. "Default" = temperature omitted or exactly 1 (Anthropic's
 *     default); topP / topK have no default, so ANY explicit value is
 *     non-default and stripped for the adaptive family.
 *   - Sonnet 5 ships a new tokenizer: the same text counts ≈ +30% tokens vs
 *     Sonnet 4.6. This does NOT change request shape, but char-based token
 *     budget estimates (model-context.ts fallback window) under-count on it —
 *     prefer SDK / upstream-reported usage. (Note carried in model-context.ts.)
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
  /** Optional sampling params. The adaptive family (Sonnet 5 / Fable 5 /
   *  Opus 4.7+) 400s on non-default values; the sanitizer strips them and
   *  reports the removal via `strippedSamplingParams`. Default = omitted or
   *  temperature===1; topP / topK have no default so any explicit value is
   *  non-default. Non-adaptive models pass through untouched. */
  temperature?: number;
  topP?: number;
  topK?: number;
}

/** Sampling params that survived sanitization and are safe to send. */
export interface SanitizedSampling {
  temperature?: number;
  topP?: number;
  topK?: number;
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
  /** True when the caller asked for thinking:'disabled' on a model where
   *  thinking cannot be turned off (Fable 5: an explicit 'disabled' 400s
   *  AND an omitted param still runs adaptive thinking). The sanitized
   *  request omits the param to stay wire-valid, but the user's "thinking
   *  off" choice is NOT honored — callers MUST surface this (one-shot
   *  notification), never swallow it silently. */
  thinkingForcedOn: boolean;
  /** Sampling params (temperature / topP / topK) that are safe to send after
   *  sanitization. For the adaptive family, non-default values are removed and
   *  their names appear in `strippedSamplingParams`; for non-adaptive models
   *  every provided value survives here. Empty object when the caller passed
   *  no sampling params. */
  sampling: SanitizedSampling;
  /** Names of sampling params dropped because they were non-default on a model
   *  that 400s on non-default sampling (the adaptive family). Non-empty means
   *  the caller MUST tell the user their sampling choice wasn't sent (same
   *  surface-don't-swallow rule as `thinkingForcedOn`). Empty when nothing was
   *  stripped. */
  strippedSamplingParams: Array<'temperature' | 'topP' | 'topK'>;
}

// Opus 4.7 and 4.8 share the adaptive-thinking contract (no manual extended
// thinking; 1M context by default). Add future same-family versions to the
// `[78]` character class. Matches BOTH the dash upstream (`claude-opus-4-8`,
// first-party) and the dotted slug (`anthropic/claude-opus-4.8`, OpenRouter):
// OpenRouter currently routes via the OpenAI SDK, but a future Anthropic-skin
// / provider override could send the dotted form here, so we don't rely on
// that assumption (Codex review P2, 2026-05-29).
// All model-family patterns below are BOUNDED on both sides (Codex review P1,
// 2026-07-18). An unbounded `/sonnet-?5/i` matches `claude-sonnet-50` — a model
// nobody has verified anything about — and hands it the whole adaptive-thinking
// contract. Capability matching must fail closed on unknown IDs, so:
//   - left  `(?:^|[^a-z0-9])` — the family token can't be a suffix of a longer word
//   - right `(?![0-9])`       — the version number can't be a prefix of a longer
//                               version (`-5` must not match `50`), while still
//                               allowing dated/tagged variants (`-5-20260101`,
//                               `-5[1m]`) where a non-digit follows.
// Two-part versions additionally require the `-`/`.` separator: without it,
// `opus-4[78]` also claims `claude-opus-48`, another unknown-ID false positive.
// Every real ID carries the separator (`claude-opus-4-8`, `claude-opus-4.8`).
const OPUS_ADAPTIVE_THINKING_PATTERN = /(?:^|[^a-z0-9])opus-?4[-.][78](?![0-9])/i;

// Fable 5 (claude-fable-5, 2026-06 launch) shares the Opus 4.7/4.8 request
// contract (sampling params removed; 1M default) with ONE extra breaking
// change per the official migration guide: thinking CANNOT be turned off.
// "Adaptive thinking is the only thinking mode on claude-fable-5 ...
// thinking: {type: 'disabled'} returns an error. On Claude Opus 4.8,
// requests without a thinking field run without thinking; on
// claude-fable-5, those requests run with adaptive thinking."
// So omitting the param avoids the 400 but does NOT mean "thinking off" —
// callers must surface that via `thinkingForcedOn` (Codex review P1,
// 2026-06-10). Matches `claude-fable-5`, `fable-5`, and tagged variants
// like `claude-fable-5[1m]`.
const FABLE_PATTERN = /(?:^|[^a-z0-9])fable-?5(?![0-9])/i;

// Sonnet 5 (claude-sonnet-5, 2026-07 launch) shares the Opus 4.7/4.8 request
// contract (no manual extended thinking; 1M default context; non-default
// sampling 400s). Two things set it apart from Fable 5:
//   1. Thinking CAN be turned off — thinking:{type:'disabled'} is ACCEPTED
//      (Fable 5 400s on it). So Sonnet 5 must NOT use the fable
//      thinkingForcedOn path — an explicit 'disabled' passes straight through.
//   2. New tokenizer (~+30% tokens for the same text) — a budget note, not a
//      wire concern (see model-context.ts).
// Matches `claude-sonnet-5`, `sonnet-5`, and tagged variants like
// `claude-sonnet-5[1m]`. Deliberately does NOT match `claude-sonnet-4-6`
// (the `-5` anchor keeps the non-adaptive 4.6 out of the family).
const SONNET_5_PATTERN = /(?:^|[^a-z0-9])sonnet-?5(?![0-9])/i;

export function isFableModel(model: string | undefined): boolean {
  if (!model) return false;
  return FABLE_PATTERN.test(model);
}

export function isSonnet5Model(model: string | undefined): boolean {
  if (!model) return false;
  return SONNET_5_PATTERN.test(model);
}

// ── Anthropic API effort support (per-model allowlist) ──────────
//
// SEPARATE AXIS from the adaptive-thinking family above. `output_config.effort`
// is only accepted by the models Anthropic lists as effort-capable
// (https://platform.claude.com/docs/en/build-with-claude/effort, verified
// 2026-07-18); sending it to any other model is not a supported request shape.
// The two sets happen to coincide today, but they answer different questions
// ("does manual extended thinking 400?" vs "does the API accept effort?"), so
// they stay independent — a future model could support effort without the
// adaptive-thinking contract, or vice versa.
//
// NOT derived from catalog `capabilities.supportedEffortLevels`: that flag is
// the UI picker / Claude Code CLI (SDK runtime) capability, which is a broader
// set — e.g. first-party `claude-haiku-4-5-20251001` declares
// supportedEffortLevels ['low','medium','high'] there while the Anthropic API's
// effort list does NOT include Haiku 4.5. Gating the native wire on the catalog
// would keep sending effort to models the API doesn't accept it on (the exact
// regression Codex reproduced: haiku 4.5 + max reached the wire as
// {"effort":"max"}).
//
// Each entry carries the official breadcrumb it was sourced from. Add a model
// here ONLY after confirming it on Anthropic's effort docs — not by inferring
// from a version-number pattern.
//
// The list is MODEL-level ("does the API accept output_config.effort at all?"),
// deliberately not level-level. Which levels a model exposes is the catalog's
// `capabilities.supportedEffortLevels` job: it drives the composer picker and
// the s07 reset-to-Auto path, so an unsupported level never gets selected in the
// first place. Each breadcrumb records the official level set for review, but
// no code reads it — a live-looking field nothing enforces would be worse than
// prose (semantic-acceptance rule: no fields without a real source).
//
// Patterns are bounded the same way as the family patterns above — `sonnet-?4`
// without `(?![0-9])` would claim `claude-sonnet-40`, and unknown IDs must fail
// closed to "effort not supported" rather than inherit a neighbour's contract.
export const ANTHROPIC_API_EFFORT_MODELS: ReadonlyArray<{
  /** Matches upstream IDs and dotted/tagged variants (e.g. `claude-opus-4.8`, `claude-sonnet-5[1m]`). */
  pattern: RegExp;
  /** Which official source lists this model as effort-capable. */
  breadcrumb: string;
}> = [
  { pattern: /(?:^|[^a-z0-9])opus-?4[-.]7(?![0-9])/i, breadcrumb: 'anthropic effort docs — Opus 4.7, GA output_config.effort (low/medium/high/xhigh/max)' },
  { pattern: /(?:^|[^a-z0-9])opus-?4[-.]8(?![0-9])/i, breadcrumb: 'anthropic effort docs — Opus 4.8, GA output_config.effort (low/medium/high/xhigh/max)' },
  { pattern: /(?:^|[^a-z0-9])fable-?5(?![0-9])/i, breadcrumb: 'anthropic effort docs + Fable 5 migration guide (low/medium/high/xhigh/max)' },
  { pattern: /(?:^|[^a-z0-9])sonnet-?5(?![0-9])/i, breadcrumb: 'anthropic effort docs + whats-new-sonnet-5 (low/medium/high/xhigh/max)' },
  // Sonnet 4.6 IS on Anthropic's effort list (low/medium/high/max — no xhigh),
  // and the first-party catalog entry already declares supportsEffort with that
  // exact level set. Omitting it here was the Codex review P1: the composer
  // legitimately offered the picker, the wire silently dropped the pick, and the
  // user got a "this model doesn't support effort" toast that contradicted both
  // the UI and the provider. Non-adaptive thinking (manual extended thinking
  // still works here) is a SEPARATE axis — see isOpusAdaptiveThinkingModel.
  { pattern: /(?:^|[^a-z0-9])sonnet-?4[-.]6(?![0-9])/i, breadcrumb: 'anthropic effort docs — Claude Sonnet 4.6 (low/medium/high/max; no xhigh)' },
];

/**
 * Whether the Anthropic Messages API accepts `output_config.effort` for this
 * model. Callers on the native/AI-SDK path MUST gate the effort field on this —
 * an unsupported model has to omit effort AND tell the user their pick wasn't
 * sent (same surface-don't-swallow rule as `thinkingForcedOn`).
 *
 * Unknown / undefined models return false (fail-closed): omitting effort
 * degrades to the model's own default, whereas sending an unsupported field
 * risks a 400 on the whole turn.
 */
export function anthropicApiSupportsEffort(model: string | undefined): boolean {
  if (!model) return false;
  return ANTHROPIC_API_EFFORT_MODELS.some(({ pattern }) => pattern.test(model));
}

export function isOpusAdaptiveThinkingModel(model: string | undefined): boolean {
  if (!model) return false;
  // Fable 5 and Sonnet 5 are in the same adaptive-thinking family — every
  // 4.7+ guard (enabled→adaptive conversion, no context-1m beta, effort
  // pass-through) applies to them too. Fable 5's extra "can't disable
  // thinking" rule is handled separately via isFableModel below.
  return OPUS_ADAPTIVE_THINKING_PATTERN.test(model)
    || FABLE_PATTERN.test(model)
    || SONNET_5_PATTERN.test(model);
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
  let thinkingForcedOn = false;
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
      // Fable 5 ONLY: thinking cannot be turned off. An explicit
      // { type: 'disabled' } returns 400, and a request WITHOUT a thinking
      // field still runs adaptive thinking (official migration guide).
      // Omitting is the only wire-valid shape, but it is NOT "thinking
      // off" — flag it so callers tell the user instead of silently
      // misrepresenting their choice.
      //
      // NOT Sonnet 5: on Sonnet 5 thinking:{type:'disabled'} is a VALID,
      // honored request (adaptive is the default, but it can be turned off).
      // Sonnet 5 is in the adaptive family (isOpusAdaptiveThinking) but not
      // isFableModel, so it falls through here and 'disabled' passes straight
      // through untouched — same behavior as Opus 4.8.
      thinking = undefined;
      thinkingForcedOn = true;
    }
  }

  // Opus 4.7+ ship 1M by default — the beta header is unnecessary and
  // kept out to make regression hunting cleaner.
  const applyContext1mBeta = !!input.context1m && !isOpusAdaptiveThinking;

  // Sampling guard. The adaptive family 400s on non-default temperature/top_p/
  // top_k; strip non-defaults and report them so the caller can surface the
  // drop. Non-adaptive models (e.g. Sonnet 4.6) pass sampling through untouched
  // — the guard must not misfire on them.
  const sampling: SanitizedSampling = {};
  const strippedSamplingParams: Array<'temperature' | 'topP' | 'topK'> = [];
  if (isOpusAdaptiveThinking) {
    // temperature: default is 1 (Anthropic). Omitted or exactly 1 is fine;
    // anything else 400s → strip + report.
    if (input.temperature !== undefined) {
      if (input.temperature === 1) sampling.temperature = 1;
      else strippedSamplingParams.push('temperature');
    }
    // topP / topK have no default — ANY explicit value is non-default.
    if (input.topP !== undefined) strippedSamplingParams.push('topP');
    if (input.topK !== undefined) strippedSamplingParams.push('topK');
  } else {
    if (input.temperature !== undefined) sampling.temperature = input.temperature;
    if (input.topP !== undefined) sampling.topP = input.topP;
    if (input.topK !== undefined) sampling.topK = input.topK;
  }

  return {
    thinking,
    effort: input.effort as string | undefined,
    applyContext1mBeta,
    isOpusAdaptiveThinking,
    thinkingForcedOn,
    sampling,
    strippedSamplingParams,
  };
}
