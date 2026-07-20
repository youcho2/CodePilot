/**
 * Codex app-server reasoning-effort compatibility.
 *
 * ── Phase 0 (2026-07-17): per-model allowlist, not a global clamp ──────
 *
 * The rule is now "send exactly what THIS model declares in `model/list`":
 *
 *   - GPT-5.6 Sol declares low/medium/high/xhigh/max/ultra. Its `xhigh` /
 *     `max` are REAL and are forwarded verbatim — the old global clamp
 *     silently downgraded them to `high`, so the user paid for a tier the
 *     wire never carried (exactly the "UI 数字不是用户以为的意思" failure).
 *   - A level the current model does not declare is OMITTED, never coerced
 *     into a neighbouring tier. Omission lets Codex apply its own default;
 *     coercion invents a semantic the user didn't choose.
 *
 * `clampCodexEffort` survives ONLY as the no-capability-info fallback (cold
 * model/list cache, logged out, old binary). That path still can't know
 * whether the binary is one of the strict old builds that REJECT unknown
 * variants FATALLY — observed 2026-05-31 with `/opt/homebrew/bin/codex`:
 *   `Failed to deserialize overridden config: unknown variant `xhigh``
 * (even codex 0.133 only tolerates them with a warning, falling back to
 * `medium`). Absent evidence, staying conservative there is correct.
 *
 * Scope: codex_runtime ONLY. Claude Code / Native runtimes keep the full
 * union for Anthropic models — do NOT route their effort through here.
 *
 * Root-cause + POC: docs/research/packaged-preview-runtime-diagnosis-2026-05-31.md
 * Schema drift + 5.6 tiers: docs/research/foundation-experience-refresh-2026-07-17.md
 */

/**
 * Reasoning-effort levels assumed safe when the current model's real
 * capability list is UNKNOWN. Deliberately the old conservative set — this
 * is the fallback floor, not a statement about what Codex supports today.
 */
export const CODEX_SUPPORTED_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;

export type CodexEffort = (typeof CODEX_SUPPORTED_EFFORTS)[number];

/**
 * Tiers a Codex model may declare that must NOT appear in the GENERIC effort
 * selector shared with every other provider.
 *
 * `ultra` is a Codex-only product tier whose multi-agent semantics CodePilot
 * has not modeled. Listing it next to low/medium/high would read as "one more
 * notch of the same dial", which is not what it is. Parsed honestly from
 * model/list, withheld from the shared menu until it's actually wired.
 */
export const CODEX_GENERIC_EXCLUDED_EFFORTS: readonly string[] = ['ultra'];

/**
 * Project a model's declared tiers onto the generic effort selector.
 * Codex-exclusive tiers are dropped; order is preserved.
 */
export function toGenericEffortLevels(declared: readonly string[] | undefined): string[] {
  if (!declared) return [];
  return declared.filter((level) => !CODEX_GENERIC_EXCLUDED_EFFORTS.includes(level));
}

/**
 * Resolve the effort to put on the `turn/start` wire for THIS model.
 *
 * @param effort   what the user selected (undefined = Auto → omit).
 * @param declaredLevels the model's `model/list` tiers, or undefined when we
 *   have no capability info (cold cache / logged out / old binary).
 *
 * - declared allowlist present → pass through iff declared, else omit.
 *   `xhigh` / `max` are forwarded verbatim when the model claims them.
 * - no capability info → conservative {@link clampCodexEffort} fallback.
 */
export function resolveCodexEffort(
  effort: string | undefined | null,
  declaredLevels: readonly string[] | undefined,
): string | undefined {
  if (!effort) return undefined;
  if (declaredLevels && declaredLevels.length > 0) {
    // Per-model truth wins — including tiers the old global clamp downgraded.
    return declaredLevels.includes(effort) ? effort : undefined;
  }
  return clampCodexEffort(effort);
}

/**
 * Conservative fallback for when the current model's declared tiers are
 * unknown. Prefer {@link resolveCodexEffort}, which consults the real
 * per-model allowlist first and only falls back to this.
 *
 * - `xhigh` / `max`            → `high`  (unknown-capability guess, see above)
 * - `minimal`/`low`/`medium`/`high` → unchanged
 * - `undefined` / `null` / unknown  → `undefined` (omit; let Codex use its
 *                                      own default rather than risk a reject)
 */
export function clampCodexEffort(effort: string | undefined | null): CodexEffort | undefined {
  if (!effort) return undefined;
  if (effort === 'xhigh' || effort === 'max') return 'high';
  if ((CODEX_SUPPORTED_EFFORTS as readonly string[]).includes(effort)) {
    return effort as CodexEffort;
  }
  return undefined;
}
