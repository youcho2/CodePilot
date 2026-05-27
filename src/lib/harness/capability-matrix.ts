/**
 * Capability matrix — Phase 5e Phase 2 (2026-05-17).
 *
 * Derived view of the Runtime × Provider × Capability support table
 * that Settings UI consumes. **Pure derivation** from
 * `capability-contract.ts` + `harness-bundle.ts` — no parallel hand-
 * written table is allowed. Any drift between Settings copy and this
 * matrix is enforced as a build failure in
 * `harness-capability-matrix.test.ts`.
 *
 * Phase 5e contract:
 *   - Every Runtime × capability cell carries one of four statuses
 *     (executable / perception_only / unavailable / undetermined).
 *   - `perception_only` always carries a `perceptionHint` so the UI
 *     can show the user which Runtime to switch to.
 *   - `unavailable` always carries a `reason` and an optional
 *     `suggestedRuntime`.
 *   - Capabilities with capability-contract `status === 'deferred'`
 *     surface as `unavailable` on every Runtime where the exposure
 *     is `unsupported`; this prevents Settings from displaying
 *     misleading "Codex supports dashboard pin" while the bridge
 *     doesn't actually mount it (the catalog drift Phase 0.5 P0
 *     audit fixed for `assistant_buddy` already; matrix derivation
 *     mechanises it for the rest).
 */

import type { RuntimeId } from '@/lib/runtime/runtime-id';
import {
  HARNESS_CAPABILITIES,
  type CapabilityContract,
} from './capability-contract';
import {
  CODEPILOT_TOOL_MUTATION_LEVELS,
  type MutationLevel,
} from './mutation-level';

export type CapabilityMatrixStatus =
  | 'executable'
  | 'perception_only'
  | 'unavailable'
  | 'undetermined';

export interface CapabilityMatrixCell {
  readonly runtimeId: RuntimeId;
  readonly capabilityId: string;
  readonly displayName: string;
  readonly status: CapabilityMatrixStatus;
  /** Human-readable line the Settings UI shows under the capability
   *  name. Always populated — even for `executable` cells where it
   *  reads "可调用". The status field above is the machine-readable
   *  flag; this is the UI string. */
  readonly statusLine: string;
  /** Tool names the model can call when status === 'executable'.
   *  Empty for non-executable cells. */
  readonly toolNames: readonly string[];
  /** When the capability is `perception_only` or `unavailable`, the
   *  Runtime that CAN execute it (if any). UI uses this to render a
   *  "切到 X Runtime 启用" hint. */
  readonly suggestedRuntime?: RuntimeId;
  /**
   * Phase 8 Phase 4 (2026-05-27) — optional bilingual caveat key
   * (resolved via `capability-display-text.ts` `getCapabilityNote`).
   * Shown under the capability REGARDLESS of status. Used when a
   * capability is `executable` at the Runtime layer but carries an
   * honest caveat (e.g. Memory under Codex Account is wired + callable
   * via native MCP injection, but whether the model autonomously uses
   * it in chat is pending the Phase 5 real-login smoke).
   */
  readonly noteKey?: string;
  /**
   * Phase 5e review fix P2 #5 (2026-05-18) — trust / approval boundary
   * derived from `CODEPILOT_TOOL_MUTATION_LEVELS`. UI shows a badge
   * next to the capability name so the user knows whether the tools
   * run automatically or require approval. Always populated for
   * `executable` cells; `undefined` for non-executable cells (model
   * can't call them, so the boundary is moot).
   *
   *   - `auto_safe`            → all tools `safe_read` (e.g. memory,
   *                              widget guidelines, dashboard list,
   *                              cli list)
   *   - `requires_approval`    → at least one tool `mutating_local`
   *                              or `mutating_external` (dashboard
   *                              pin, schedule_task, image gen)
   *   - `side_effect`          → at least one tool `side_effect` (notify)
   *                              and no mutating_* sibling
   *   - `mixed`                → multiple kinds within the capability
   *                              (e.g. tasks_and_notify mixes safe
   *                              list + mutating schedule + side_effect
   *                              notify)
   *
   * Derived strictly from `mutation-level.ts` — UI must NOT write
   * its own copy. `harness-capability-matrix.test.ts` pins the
   * derivation against the mutation level table.
   */
  readonly trustBoundary?:
    | 'auto_safe'
    | 'requires_approval'
    | 'side_effect'
    | 'mixed';
}

const ALL_RUNTIMES: readonly RuntimeId[] = [
  'claude_code',
  'codepilot_runtime',
  'codex_runtime',
];

function exposureKey(
  runtimeId: RuntimeId,
): 'claudecode_sdk' | 'native' | 'codex_proxy' {
  switch (runtimeId) {
    case 'claude_code':
      return 'claudecode_sdk';
    case 'codepilot_runtime':
      return 'native';
    case 'codex_runtime':
      return 'codex_proxy';
  }
}

function runtimeDisplayName(runtimeId: RuntimeId): string {
  switch (runtimeId) {
    case 'claude_code':
      return 'ClaudeCode SDK';
    case 'codepilot_runtime':
      return 'CodePilot Native';
    case 'codex_runtime':
      return 'Codex';
  }
}

/**
 * Find ALL Runtimes where a given capability has an executable
 * exposure. Pre-fix (round 7 user feedback) this scoped to
 * `cap.status === 'live'`, which incorrectly hid the fact that
 * `dashboard` / `cli_tools` (both `status: 'deferred'`) still have
 * working `ai_sdk_tool` / `mcp_server` exposures on ClaudeCode +
 * Native — only the Codex bridge is missing. Top-level `status` is
 * the **product** decision about whether to formally promise the
 * capability; per-runtime executability is what the user actually
 * cares about in the Settings clipboard.
 *
 * Returns the list in ALL_RUNTIMES order so the first entry is the
 * default "suggested switch-to" Runtime.
 */
function executableRuntimes(cap: CapabilityContract): readonly RuntimeId[] {
  const out: RuntimeId[] = [];
  for (const r of ALL_RUNTIMES) {
    if (cap.exposure[exposureKey(r)].kind !== 'unsupported') out.push(r);
  }
  return out;
}

/** Convenience: the first Runtime where a capability is executable.
 *  Used for legacy `suggestedRuntime` callers; the multi-runtime
 *  list is preferred for user-facing reason strings. */
function firstExecutableRuntime(cap: CapabilityContract): RuntimeId | undefined {
  return executableRuntimes(cap)[0];
}

/**
 * Phase 5e review fix P2 #5 — derive the capability-level trust
 * boundary from the per-tool mutation levels of its `toolNames`.
 *
 * Rules:
 *   - empty toolNames → undefined (capability isn't tool-driven)
 *   - all `safe_read`             → 'auto_safe'
 *   - all `side_effect`           → 'side_effect'
 *   - all `mutating_local` /
 *     `mutating_external`         → 'requires_approval'
 *   - mixed                        → 'mixed' (e.g. tasks_and_notify
 *                                    has list:safe_read + schedule:
 *                                    mutating_local + notify:side_effect)
 *
 * A tool without a classification fails the
 * `mutation-level-contract.test.ts` completeness pin, so we know all
 * catalog tools resolve. The defensive fallback below treats unknown
 * as `mutating_local` so an unclassified tool errs on the safe side
 * (caller would still see 'requires_approval').
 */
function deriveTrustBoundary(
  cap: CapabilityContract,
): 'auto_safe' | 'requires_approval' | 'side_effect' | 'mixed' | undefined {
  if (cap.toolNames.length === 0) return undefined;
  const levels = new Set<MutationLevel>();
  for (const name of cap.toolNames) {
    const level = CODEPILOT_TOOL_MUTATION_LEVELS[name];
    if (level) {
      levels.add(level);
    } else {
      // Unclassified tool — defensive fallback. The completeness test
      // will fail loudly elsewhere; we keep the derivation graceful so
      // Settings UI doesn't crash if someone adds a tool without
      // classifying it.
      levels.add('mutating_local');
    }
  }
  if (levels.size === 1) {
    const only = [...levels][0];
    if (only === 'safe_read') return 'auto_safe';
    if (only === 'side_effect') return 'side_effect';
    return 'requires_approval'; // mutating_local or mutating_external
  }
  // Two or more distinct levels — capability mixes safe + mutating /
  // side_effect tools. UI surfaces this so the user understands "some
  // calls are auto, some need approval".
  return 'mixed';
}

/**
 * Derive one cell of the matrix.
 *
 * Phase 5e round 7 fix (2026-05-18 user feedback) — derivation now
 * uses per-runtime `exposure.kind` ONLY. Pre-fix `cap.status ===
 * 'deferred'` short-circuited every Runtime to "unavailable", which
 * was wrong for capabilities like `dashboard` / `cli_tools` whose
 * deferred status is product-level (Codex bridge missing) but
 * whose ClaudeCode SDK + Native exposures are already wired
 * (`mcp_server` / `ai_sdk_tool`). The Settings clipboard now mirrors
 * what each Runtime can actually do.
 *
 * `cap.status` and `cap.deferredReason` remain the engineering
 * contract — drift tests still inspect them — but they no longer
 * drive UI status.
 */
function deriveCell(
  runtimeId: RuntimeId,
  cap: CapabilityContract,
): CapabilityMatrixCell {
  const exposure = cap.exposure[exposureKey(runtimeId)];

  if (exposure.kind === 'unsupported') {
    const suggested = firstExecutableRuntime(cap);
    return {
      runtimeId,
      capabilityId: cap.id,
      displayName: cap.displayName,
      // No suggested runtime → the capability has no executable
      // home anywhere; that's a true `unavailable`. Otherwise the
      // user can switch elsewhere → `perception_only`.
      status: suggested ? 'perception_only' : 'unavailable',
      // statusLine is the legacy engineering string used by older
      // tests that don't know about the user-facing layer. UI MUST
      // resolve user copy via `capability-display-text.ts` keyed by
      // `capabilityId`; this field stays for back-compat only.
      statusLine: suggested
        ? `Not callable on ${runtimeDisplayName(runtimeId)} — switch to ${runtimeDisplayName(suggested)}.`
        : `Not callable on any Runtime in the current catalog.`,
      toolNames: [],
      ...(suggested ? { suggestedRuntime: suggested } : {}),
    };
  }

  // Executable — trust boundary derived from per-tool mutation levels.
  const trustBoundary = deriveTrustBoundary(cap);
  return {
    runtimeId,
    capabilityId: cap.id,
    displayName: cap.displayName,
    status: 'executable',
    statusLine: '可调用',
    toolNames: cap.toolNames,
    ...(trustBoundary ? { trustBoundary } : {}),
  };
}

/**
 * Build the full Runtime × Capability matrix. Returns one row per
 * runtime, with one cell per capability.
 */
export function buildCapabilityMatrix(): Record<
  RuntimeId,
  readonly CapabilityMatrixCell[]
> {
  const out: Partial<Record<RuntimeId, CapabilityMatrixCell[]>> = {};
  for (const runtimeId of ALL_RUNTIMES) {
    const cells: CapabilityMatrixCell[] = [];
    for (const cap of HARNESS_CAPABILITIES) {
      cells.push(deriveCell(runtimeId, cap));
    }
    out[runtimeId] = cells;
  }
  return out as Record<RuntimeId, readonly CapabilityMatrixCell[]>;
}

/** Convenience: cells for one Runtime — what Settings UI renders
 *  for a single Runtime card. */
export function capabilityMatrixForRuntime(
  runtimeId: RuntimeId,
): readonly CapabilityMatrixCell[] {
  return HARNESS_CAPABILITIES.map((cap) => deriveCell(runtimeId, cap));
}

// ─────────────────────────────────────────────────────────────────────
// Phase 5e Phase 3 — Provider-aware downgrade (Codex Account path)
// ─────────────────────────────────────────────────────────────────────

/**
 * Phase 5e Phase 3 (2026-05-18) — `codex_account` provider path
 * does NOT go through CodePilot's `codepilot_proxy` injection (see
 * `provider-proxy.ts:180`), so the CodePilot built-in tool bridge
 * never mounts. The default `codex_runtime` matrix row assumes the
 * proxy IS present (which is correct for GLM/Kimi/OpenAI-compat
 * providers under Codex Runtime). When the user picks Codex Account
 * as the upstream provider, the matrix must be re-derived to
 * demote every bridge-only built-in capability to `perception_only`
 * with a clear suggested-Runtime explanation.
 *
 * Per user product decision (B-Settings variant) — does NOT silently
 * "make it work" via Codex Account, does NOT inject Codex auth, does
 * NOT promise capabilities the protocol can't support. Just tells
 * the user honestly in Settings.
 *
 * Capabilities affected:
 *   - image_generation / media_import → bridge_executable on codex_proxy,
 *     NOT on codex_account (native injection pending the MediaBlock result
 *     contract; stay perception_only under Codex Account for now).
 *   - dashboard / cli_tools / assistant_buddy → already deferred /
 *     unsupported (no further downgrade needed).
 *
 * REMOVED from this set (reach Codex Account via NATIVE config.mcp_servers
 * injection, not the proxy bridge — runtime injects, served by
 * /api/codex/mcp/[server]):
 *   - `memory` (Phase 4) — login-smoke verified; affirmative note.
 *   - `widget` (#31) — keyword-gated native injection; caveat note.
 *   - `tasks_and_notify` (#31) — always-on native injection; mutating tools
 *     route to user approval; caveat note (autonomous use pending smoke).
 */
const CODEX_ACCOUNT_BRIDGE_DEMOTED_CAPS: ReadonlySet<string> = new Set([
  'image_generation',
  'media_import',
]);

/** Built-ins reachable on Codex Account via native MCP injection → keep
 *  executable but attach an honest per-capability note (key in
 *  capability-display-text CAPABILITY_NOTES). */
const CODEX_ACCOUNT_NATIVE_NOTE_BY_CAP: Readonly<Record<string, string>> = {
  memory: 'memory_codex_native',
  widget: 'widget_codex_native',
  tasks_and_notify: 'tasks_codex_native',
};

/**
 * Returns the capability matrix for a specific Runtime + Provider
 * combination. For most combinations this is identical to
 * `capabilityMatrixForRuntime` — the override only fires when the
 * provider's protocol fundamentally can't host the CodePilot bridge.
 */
export function capabilityMatrixForRuntimeProvider(
  runtimeId: RuntimeId,
  providerId?: string,
): readonly CapabilityMatrixCell[] {
  const base = capabilityMatrixForRuntime(runtimeId);
  if (runtimeId !== 'codex_runtime' || providerId !== 'codex_account') {
    return base;
  }
  // Demote bridge-only capabilities to perception_only for Codex Account.
  return base.map((cell) => {
    // Native-injected built-ins (memory, widget) stay executable under Codex
    // Account, each with an honest per-capability note.
    const nativeNote = CODEX_ACCOUNT_NATIVE_NOTE_BY_CAP[cell.capabilityId];
    if (nativeNote && cell.status === 'executable') {
      return { ...cell, noteKey: nativeNote };
    }
    if (!CODEX_ACCOUNT_BRIDGE_DEMOTED_CAPS.has(cell.capabilityId)) {
      return cell;
    }
    if (cell.status !== 'executable') {
      // Already unavailable / perception_only — keep as is.
      return cell;
    }
    return {
      ...cell,
      status: 'perception_only' as const,
      statusLine:
        'Codex Account 协议不开放第三方工具挂载，CodePilot 桥不可用。如需 CodePilot 内置能力，请切到 CodePilot Native 或 ClaudeCode SDK Runtime。',
      toolNames: [] as readonly string[],
      suggestedRuntime: 'codepilot_runtime' as const,
    };
  });
}

/** Test helper: summarise matrix as a flat list for assertions. */
export function flattenMatrix(): readonly CapabilityMatrixCell[] {
  const matrix = buildCapabilityMatrix();
  const out: CapabilityMatrixCell[] = [];
  for (const cells of Object.values(matrix)) {
    out.push(...cells);
  }
  return out;
}
