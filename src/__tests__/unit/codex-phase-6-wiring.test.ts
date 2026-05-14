/**
 * Phase 5 Phase 6 (2026-05-14) — source-level pin for Settings收口.
 *
 * IA correction (2026-05-14, same day): Codex shouldn't be a
 * top-level Settings tab — it spans two domains (engine + provider).
 * The standalone /settings/codex page is now a transitional redirect;
 * its content lives in Runtime (app-server status) + Providers
 * (account / quota) + Models (Codex Account models).
 *
 * Pins kept here cover the surfaces that survived the correction:
 *
 *   1. /settings/codex → redirect to /settings/runtime
 *   2. nav-config does NOT register a top-level "codex" section
 *   3. Chat model picker shows codex_runtime-specific disclosure +
 *      empty-state copy (per user spec 2026-05-14: filter, not
 *      gray-out; "切回 Claude Code / CodePilot Runtime" wording).
 *   4. Electron `before-quit` hook calls /api/codex/dispose before
 *      `killServer()` (avoids orphan Codex grandchild).
 *   5. /api/codex/rate-limits route exists and wraps
 *      `account/rateLimits/read`.
 *
 * No live codex binary in CI — these are source-level greps. Same
 * pattern as round 3 / 4 / 5 pins.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

// ─────────────────────────────────────────────────────────────────────
// IA correction — top-level Codex tab removed; URL redirected
// ─────────────────────────────────────────────────────────────────────

describe('Settings IA — no top-level Codex tab (IA correction)', () => {
  const navSrc = fs.readFileSync(
    path.join(repoRoot, 'components/settings/nav-config.ts'),
    'utf8',
  );

  it('SettingsSection union does NOT include "codex"', () => {
    // Codex is split across runtime / providers / models — not its own
    // section. A regression here would put the misaligned tab back.
    assert.doesNotMatch(navSrc, /\|\s*['"]codex['"]/);
  });

  it('SETTINGS_NAV_ITEMS does NOT contain a codex entry', () => {
    assert.doesNotMatch(navSrc, /id:\s*['"]codex['"]/);
  });

  it('/settings/codex remains routable as a redirect to /settings/runtime', () => {
    // Deep links from the brief window the standalone page shipped
    // should still resolve — just to the correct location.
    const pageSrc = fs.readFileSync(
      path.join(repoRoot, 'app/settings/codex/page.tsx'),
      'utf8',
    );
    assert.match(pageSrc, /import\s*\{\s*redirect\s*\}\s*from\s*['"]next\/navigation['"]/);
    assert.match(pageSrc, /redirect\(['"]\/settings\/runtime/);
  });

  it('CodexPanel component is removed (content moved to runtime / providers / models)', () => {
    const panelPath = path.join(repoRoot, 'components/settings/CodexPanel.tsx');
    assert.equal(
      fs.existsSync(panelPath),
      false,
      'CodexPanel.tsx must not exist — its content lives in RuntimePanel + ProviderManager + ModelsSection',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Rate limits API — wraps `account/rateLimits/read`
// ─────────────────────────────────────────────────────────────────────

describe('/api/codex/rate-limits route (IA correction)', () => {
  it('GET route exists and imports readCodexRateLimits', () => {
    const routeSrc = fs.readFileSync(
      path.join(repoRoot, 'app/api/codex/rate-limits/route.ts'),
      'utf8',
    );
    assert.match(
      routeSrc,
      /import\s*\{\s*readCodexRateLimits\s*\}\s*from\s*['"]@\/lib\/codex\/account['"]/,
    );
    assert.match(routeSrc, /export\s+async\s+function\s+GET/);
    assert.match(routeSrc, /readCodexRateLimits\(\)/);
  });

  it('readCodexRateLimits calls account/rateLimits/read with narrowed shape', () => {
    const accountSrc = fs.readFileSync(
      path.join(repoRoot, 'lib/codex/account.ts'),
      'utf8',
    );
    assert.match(accountSrc, /export\s+async\s+function\s+readCodexRateLimits/);
    assert.match(accountSrc, /['"]account\/rateLimits\/read['"]/);
    // Must surface primary + secondary windows (the user-spec quotas
    // for 5h and 7d buckets) — not just the deprecated flat shape.
    assert.match(accountSrc, /primary:\s*toWindow/);
    assert.match(accountSrc, /secondary:\s*toWindow/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// RuntimePanel三引擎化 — Codex Runtime as a peer engine
// ─────────────────────────────────────────────────────────────────────

describe('RuntimePanel — three-engine picker (IA correction)', () => {
  const panelSrc = fs.readFileSync(
    path.join(repoRoot, 'components/settings/RuntimePanel.tsx'),
    'utf8',
  );

  it('AgentRuntime is imported from effective.ts (not duplicated locally)', () => {
    // Local 2-value duplicate caused drift; single source of truth via
    // effective.ts. Both effective.AgentRuntime and legacy.ConcreteRuntime
    // now include 'codex_runtime'.
    assert.match(
      panelSrc,
      /import\s*\{[\s\S]{0,300}type\s+AgentRuntime[\s\S]{0,100}\}\s*from\s*["']@\/lib\/runtime\/effective["']/,
    );
    assert.doesNotMatch(panelSrc, /type\s+AgentRuntime\s*=\s*["']claude-code-sdk["']\s*\|\s*["']native["']\s*;/);
  });

  it('picker grid expands to 3 columns', () => {
    assert.match(panelSrc, /grid\s+grid-cols-1\s+md:grid-cols-3\s+gap-4/);
  });

  it('Codex Runtime EnginePickerCard is rendered', () => {
    assert.match(
      panelSrc,
      /engine="codex_runtime"[\s\S]{0,2000}handleRuntimeChange\("codex_runtime"\)/,
    );
  });

  it('handleRuntimeChange flips cli_enabled only when claude-code-sdk selected', () => {
    // Codex Runtime AND CodePilot Runtime both run without the CLI,
    // so cli_enabled=true only when value === 'claude-code-sdk'.
    assert.match(
      panelSrc,
      /const\s+cliEnabledValue\s*=\s*value\s*===\s*["']claude-code-sdk["']\s*\?\s*["']true["']\s*:\s*["']false["']/,
    );
  });

  it('Codex Runtime detail card renders below the picker', () => {
    // The detail card pulls reason/impact/recovery from codexRuntimeStatus
    // and surfaces the app-server status row + Codex home + jump links.
    // Phase 6 UI收口 P1 (2026-05-14): short detail-card heading "Codex"
    // (the page title + section header carry the "Runtime / 引擎"
    // framing; repeating it on every card was redundant noise).
    assert.match(panelSrc, /<RuntimeCard\s+name="Codex"/);
    assert.match(panelSrc, /codexRuntimeStatus/);
    // Jump links to where account + models live — these are load-bearing
    // for the IA: the Codex card MUST NOT duplicate Provider / Models
    // content, just point to it.
    assert.match(panelSrc, /href="\/settings\/providers"/);
    assert.match(panelSrc, /href="\/settings\/models"/);
  });
});

describe('runtime/effective — three-engine union (IA correction)', () => {
  it('AgentRuntime accepts codex_runtime', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'lib/runtime/effective.ts'), 'utf8');
    assert.match(src, /AgentRuntime\s*=\s*["']claude-code-sdk["']\s*\|\s*["']native["']\s*\|\s*["']codex_runtime["']/);
  });

  it('runtimeDisplayLabel returns short "Codex" label for codex_runtime', () => {
    // Phase 6 UI收口 P1 fix-up (2026-05-14): label dropped the redundant
    // "Runtime" suffix so the engine picker / composer button / detail
    // card heading / runtime explainer banner all read consistently.
    const src = fs.readFileSync(path.join(repoRoot, 'lib/runtime/effective.ts'), 'utf8');
    assert.match(src, /runtime\s*===\s*["']codex_runtime["'][\s\S]{0,80}return\s+["']Codex["']/);
    assert.doesNotMatch(src, /return\s+["']Codex Runtime["']/);
  });

  it('computeEffectiveRuntime returns codex_runtime without fallback', () => {
    // Codex doesn't fall back. Send-time guardrail (claude-client.ts
    // Round 5) handles the unavailable case with a clear error.
    const src = fs.readFileSync(path.join(repoRoot, 'lib/runtime/effective.ts'), 'utf8');
    assert.match(
      src,
      /storedAgentRuntime\s*===\s*["']codex_runtime["'][\s\S]{0,80}return\s+["']codex_runtime["']/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Providers — Codex Account virtual provider card
// ─────────────────────────────────────────────────────────────────────

describe('ProviderManager — Codex Account virtual card (IA correction)', () => {
  const mgrSrc = fs.readFileSync(
    path.join(repoRoot, 'components/settings/ProviderManager.tsx'),
    'utf8',
  );

  it('imports Codex types + CodexQuotaWidget', () => {
    assert.match(mgrSrc, /CodexAccountState[\s\S]{0,80}from\s*["']@\/lib\/codex\/types["']/);
    assert.match(mgrSrc, /CodexLoginStart[\s\S]{0,80}from\s*["']@\/lib\/codex\/account["']/);
    assert.match(mgrSrc, /import\s*\{\s*CodexQuotaWidget\s*\}\s*from\s*["']\.\/CodexQuotaWidget["']/);
  });

  it('Codex Account card renders alongside OpenAI OAuth when logged in', () => {
    // The OAuth section header must trigger when EITHER provider is
    // connected — regressing this means logged-in Codex users would
    // see no card at all.
    assert.match(
      mgrSrc,
      /openaiAuth\?\.authenticated\s*\|\|\s*codexAccount\?\.kind\s*===\s*['"]logged_in['"]/,
    );
    assert.match(mgrSrc, /codexAccount\?\.kind\s*===\s*['"]logged_in['"][\s\S]{0,500}<ProviderCard/);
  });

  it('Codex card uses "登录方式" instead of "类型" for account.type', () => {
    // Phase 6 IA correction copy fix: type=chatgpt/apiKey/amazonBedrock
    // is the LOGIN METHOD, not the plan. "类型" reads as plan to users.
    // Pin the rename so a future build can't silently revert it.
    assert.match(mgrSrc, /label:\s*isZh\s*\?\s*['"]登录方式['"]/);
    assert.match(mgrSrc, /['"]Login method['"]/);
    // The Codex card MUST NOT render `account.type` under a "类型" /
    // "Type" label — that was the confusing original.
    const codexCardBlock = mgrSrc.match(/codexAccount\?\.kind\s*===\s*['"]logged_in['"][\s\S]+?<\/ProviderCard>/);
    if (codexCardBlock) {
      assert.doesNotMatch(codexCardBlock[0], /label:\s*isZh\s*\?\s*['"]类型['"]/);
      assert.doesNotMatch(codexCardBlock[0], /['"]Type['"]\s*,\s*value:\s*codexAccount\.account\.type/);
    } else {
      assert.fail('Could not locate the Codex Account ProviderCard block');
    }
  });

  it('CodexQuotaWidget is rendered inside the Codex Account card', () => {
    assert.match(mgrSrc, /<CodexQuotaWidget\s+snapshot=\{codexRateLimits\}/);
  });

  it('Codex login dialog does NOT auto window.open (feedback_no_silent_auto_irreversible)', () => {
    // Login flow renders authUrl as an explicit <a target="_blank">
    // link inside a Dialog, never window.open().
    const codexLoginDialog = mgrSrc.match(/Codex Account login dialog[\s\S]+?<\/Dialog>/);
    assert.ok(codexLoginDialog, 'Codex login dialog must exist');
    assert.doesNotMatch(codexLoginDialog![0], /window\.open\(/);
    assert.match(codexLoginDialog![0], /target=["']_blank["']/);
  });
});

describe('CodexQuotaWidget — primary + secondary windows (IA correction)', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'components/settings/CodexQuotaWidget.tsx'),
    'utf8',
  );

  it('renders both primary and secondary RateLimitWindow blocks', () => {
    assert.match(src, /snapshot\.primary[\s\S]{0,300}WindowRow/);
    assert.match(src, /snapshot\.secondary[\s\S]{0,300}WindowRow/);
  });

  it('shows usedPercent (per upstream schema), not absolute remaining tokens', () => {
    // Upstream only reports usedPercent + resetsAt — there is no
    // absolute token count. UI copy must reflect that or it implies
    // data the API doesn't actually return.
    assert.match(src, /已用\s*\$\{pct\.toFixed\(0\)\}%/);
    assert.match(src, /\$\{pct\.toFixed\(0\)\}%\s*used/);
    assert.doesNotMatch(src, /剩余\s*\d+\s*tokens?/);
    assert.doesNotMatch(src, /remaining\s*\d+\s*tokens?/i);
  });

  it('surfaces credits.balance when present (and "Unlimited" when unlimited)', () => {
    assert.match(src, /snapshot\.credits/);
    assert.match(src, /unlimited/);
    assert.match(src, /balance/);
  });

  it('warns when rateLimitReachedType is non-null', () => {
    // Split: the gate variable, the warning copy, and the rendered
    // type label live in separate code regions. Pin them
    // independently rather than via one wide regex.
    assert.match(src, /isRateLimited\s*=\s*!!snapshot\.rateLimitReachedType/);
    assert.match(src, /已触达配额上限/);
    assert.match(src, /Rate limit reached/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Models — Codex Account read-only block
// ─────────────────────────────────────────────────────────────────────

describe('Models page — Codex Account read-only block (IA correction)', () => {
  it('ModelsSection imports + renders CodexAccountModelsBlock', () => {
    const sectionSrc = fs.readFileSync(
      path.join(repoRoot, 'components/settings/ModelsSection.tsx'),
      'utf8',
    );
    assert.match(
      sectionSrc,
      /import\s*\{\s*CodexAccountModelsBlock\s*\}\s*from\s*["']\.\/CodexAccountModelsBlock["']/,
    );
    assert.match(sectionSrc, /<CodexAccountModelsBlock\s+isZh=\{isZh\}/);
  });

  it('block self-hides when not loaded / no models', () => {
    const blockSrc = fs.readFileSync(
      path.join(repoRoot, 'components/settings/CodexAccountModelsBlock.tsx'),
      'utf8',
    );
    assert.match(blockSrc, /if\s*\(\s*!loaded\s*\)\s*return\s+null/);
    assert.match(blockSrc, /if\s*\(\s*!group\s*\|\|\s*!group\.models\?\.length\s*\)\s*return\s+null/);
  });

  it('block carries the "仅 Codex" badge + "Codex only" en mirror', () => {
    // Phase 6 UI收口 P1 fix-up sweep (2026-05-14): badge follows the
    // short product name. "Codex Runtime" / "仅 Codex Runtime" was the
    // pre-sweep wording that leaked the "Runtime" suffix into a
    // qualifier badge.
    const blockSrc = fs.readFileSync(
      path.join(repoRoot, 'components/settings/CodexAccountModelsBlock.tsx'),
      'utf8',
    );
    assert.match(blockSrc, /仅 Codex/);
    assert.match(blockSrc, /Codex only/);
    // Regression guard against re-bolting the suffix.
    assert.doesNotMatch(blockSrc, /仅 Codex Runtime/);
    assert.doesNotMatch(blockSrc, /Codex Runtime only/);
  });

  it('block is read-only (no enable/disable Switch, no edit display name)', () => {
    // Phase 6 IA correction principle: Codex Account models come from
    // upstream Codex, not from CodePilot's DB — nothing to toggle.
    // Regressing to a writable list would be confusing (the toggle
    // would do nothing) AND require new persistence schema.
    const blockSrc = fs.readFileSync(
      path.join(repoRoot, 'components/settings/CodexAccountModelsBlock.tsx'),
      'utf8',
    );
    assert.doesNotMatch(blockSrc, /<Switch\b/);
    assert.doesNotMatch(blockSrc, /onCheckedChange/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Chat composer RuntimeSelector — codex_runtime stickiness (IA round 3)
//
// Pre-round-3 the chat composer hard-coded a binary ternary
// `=== 'claude-code-sdk' ? 'claude_code' : 'codepilot_runtime'` at two
// callsites and `useGlobalAgentRuntime` only typed two values. With
// `agent_runtime='codex_runtime'` stored, the RuntimeSelector trigger
// rendered "Claude Code" while Models / Settings already agreed Codex
// was the default. Round 3 expanded the hook + extracted the registry-id
// → ChatRuntime mapping into `agentRuntimeToChatRuntime()` and pins the
// new wiring here so the binary ternary can't slip back in.
// ─────────────────────────────────────────────────────────────────────

describe('Chat composer RuntimeSelector — codex_runtime support (IA round 3)', () => {
  it('useGlobalAgentRuntime preserves codex_runtime (not coerced to claude-code-sdk)', () => {
    const hookSrc = fs.readFileSync(
      path.join(repoRoot, 'hooks/useGlobalAgentRuntime.ts'),
      'utf8',
    );
    // The state type now lists all three registry ids.
    assert.match(
      hookSrc,
      /agentRuntime:\s*["']claude-code-sdk["']\s*\|\s*["']native["']\s*\|\s*["']codex_runtime["']/,
    );
    // The coercion branch handles codex_runtime as a first-class value,
    // not silently mapped to claude-code-sdk.
    assert.match(
      hookSrc,
      /stored\s*===\s*["']codex_runtime["']\s*\?\s*["']codex_runtime["']/,
    );
    // Regression guard: the old binary coercion is gone.
    assert.doesNotMatch(
      hookSrc,
      /stored\s*===\s*["']native["']\s*\?\s*["']native["']\s*:\s*["']claude-code-sdk["']/,
    );
  });

  it('agentRuntimeToChatRuntime helper exists and maps three engines correctly', () => {
    const sharedSrc = fs.readFileSync(
      path.join(repoRoot, 'lib/chat-runtime-shared.ts'),
      'utf8',
    );
    assert.match(sharedSrc, /export\s+function\s+agentRuntimeToChatRuntime/);
    assert.match(sharedSrc, /stored\s*===\s*['"]native['"][\s\S]{0,80}codepilot_runtime/);
    assert.match(sharedSrc, /stored\s*===\s*['"]codex_runtime['"][\s\S]{0,80}codex_runtime/);
    // Default branch for 'claude-code-sdk' / 'auto' / null
    assert.match(sharedSrc, /return\s+['"]claude_code['"]/);
  });

  it('both chat composer callsites use the helper (not inline binary ternary)', () => {
    for (const relativePath of ['app/chat/page.tsx', 'components/chat/ChatView.tsx']) {
      const src = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      // The new wiring: helper invocation
      assert.match(
        src,
        /effectiveRuntime=\{agentRuntimeToChatRuntime\(globalRuntime\.agentRuntime\)\}/,
        `${relativePath} must call agentRuntimeToChatRuntime`,
      );
      // The old wiring: inline binary ternary that dropped codex_runtime
      assert.doesNotMatch(
        src,
        /agentRuntime\s*===\s*['"]claude-code-sdk['"]\s*\?\s*['"]claude_code['"]\s*:\s*['"]codepilot_runtime['"]/,
        `${relativePath} must not reintroduce the binary ternary`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Model picker — full-catalog + per-row disabled (Phase 6 UI收口 P2)
//
// Replaces the earlier Slice B suite which pinned the server-side
// filter behavior + header disclosure copy. P2 inverted those:
//   - Picker always renders the FULL catalog
//   - Incompatible rows are disabled with hover tooltip explaining why
//   - Header disclosure banners removed (per-row tooltips replace them)
//   - Empty state collapses to the rare "zero providers configured"
//     case; the codex-specific empty state is gone (Codex rows just
//     appear disabled when not logged in / app-server unavailable
//     because the server omits the group entirely)
// ─────────────────────────────────────────────────────────────────────

describe('Model picker — per-row compat gating (Phase 6 UI收口 P2)', () => {
  const pickerSrc = fs.readFileSync(
    path.join(repoRoot, 'components/chat/ModelSelectorDropdown.tsx'),
    'utf8',
  );

  it('row disabled-state checks opt.supportedRuntimes against runtimeApplied', () => {
    // The load-bearing assertion: each model row computes its own
    // disabled state from the per-row annotation. Regression would
    // either hide rows again (server filter) or stop reading the
    // annotation (incompatible rows become silently clickable).
    assert.match(
      pickerSrc,
      /opt\.supportedRuntimes[\s\S]{0,80}\.includes\(runtimeApplied\)/,
    );
  });

  it('row tooltip reads from opt.unsupportedReasonByRuntime for the active runtime', () => {
    assert.match(
      pickerSrc,
      /opt\.unsupportedReasonByRuntime\?\.\[runtimeApplied!\]/,
    );
    // Generic zh + en fallbacks for rows whose upstream contract
    // doesn't supply a per-runtime reason.
    assert.match(pickerSrc, /当前 Agent 引擎不支持此模型/);
    assert.match(pickerSrc, /Current Agent engine does not support this model/);
  });

  it('recent-models section honours the same disabled-state gating', () => {
    // Without this gate, a "recently used GLM" entry would stay
    // clickable under Codex even though the active engine can't
    // serve GLM models. Same supportedRuntimes / tooltip wiring as
    // the main groups below.
    assert.match(
      pickerSrc,
      /option\.supportedRuntimes[\s\S]{0,80}\.includes\(runtimeApplied\)/,
    );
  });

  it('header disclosure banners are GONE (per-row tooltips replace them)', () => {
    // Pre-P2 the picker carried a "only showing models for X" /
    // "Codex currently supports only Codex Account models..." top
    // banner. Both are obsolete now that every row is visible with
    // its own tooltip — keeping them would be visual noise.
    assert.doesNotMatch(
      pickerSrc,
      /仅显示当前 Agent 引擎可用的模型/,
    );
    assert.doesNotMatch(
      pickerSrc,
      /Models available under the current Agent engine/,
    );
    assert.doesNotMatch(
      pickerSrc,
      /Codex 当前仅支持 Codex Account 模型/,
    );
  });

  it('empty state collapses to the generic "no providers configured" copy', () => {
    // Phase 6 UI收口 P2: with the full catalog always returned, an
    // empty groups array means "user has zero providers configured
    // at all" — rare, and the only meaningful recovery is the
    // Providers page. No more codex-specific empty-state branch.
    assert.match(pickerSrc, /providerGroups\.length\s*===\s*0/);
    assert.match(pickerSrc, /尚未配置任何服务商/);
    assert.match(pickerSrc, /No providers configured yet/);
    // Regression guard: the codex-specific empty branch must not
    // creep back in. The picker's compat gating now operates per
    // row, not per empty-state branch.
    assert.doesNotMatch(
      pickerSrc,
      /providerGroups\.length\s*===\s*0[\s\S]{0,300}runtimeApplied\s*===\s*['"]codex_runtime['"]/,
    );
  });
});

describe('useProviderModels — full-catalog fetch + client-side compat (Phase 6 UI收口 P2)', () => {
  const hookSrc = fs.readFileSync(
    path.join(repoRoot, 'hooks/useProviderModels.ts'),
    'utf8',
  );

  it('hook fetches /api/providers/models WITHOUT a runtime filter', () => {
    // Pre-P2 the hook appended ?runtime=X so the server filtered the
    // catalog. P2 inverted that: hook always fetches the full
    // catalog, runtime gating happens client-side via
    // compatibleProviderGroups.
    assert.match(hookSrc, /const\s+url\s*=\s*['"]\/api\/providers\/models['"]/);
    assert.doesNotMatch(hookSrc, /\/api\/providers\/models\?runtime=\$\{/);
  });

  it('derives compatibleProviderGroups from the full catalog + runtime param', () => {
    assert.match(hookSrc, /const\s+compatibleProviderGroups\s*=\s*useMemo/);
    // The filter pattern: keep rows without an annotation (legacy
    // fallback) OR rows whose `supportedRuntimes` lists the active
    // runtime. Two clauses, joined by `||`, anchored on the row var.
    assert.match(
      hookSrc,
      /!m\.supportedRuntimes\s*\|\|\s*m\.supportedRuntimes\.includes\(runtime\)/,
    );
  });

  it('noCompatibleProvider is derived from compatibleProviderGroups (not the raw catalog)', () => {
    assert.match(
      hookSrc,
      /noCompatibleProvider:[\s\S]{0,200}compatibleProviderGroups\.length\s*===\s*0/,
    );
  });
});

describe('/api/providers/models — annotated rows always (Phase 6 UI收口 P2)', () => {
  const routeSrc = fs.readFileSync(
    path.join(repoRoot, 'app/api/providers/models/route.ts'),
    'utf8',
  );

  it('every model row carries supportedRuntimes + unsupportedReasonByRuntime', () => {
    // Pre-P2 these fields were computed per-row inside the filter
    // block and then dropped. P2 promotes them to first-class
    // response fields so the picker can render disabled rows + the
    // tooltip without re-running getModelCompat on the client.
    assert.match(
      routeSrc,
      /supportedRuntimes:\s*cap\.supportedRuntimes/,
    );
    assert.match(
      routeSrc,
      /unsupportedReasonByRuntime:\s*cap\.unsupportedReasonByRuntime/,
    );
  });

  it('media rows are still dropped at the row layer (do not belong in chat pickers)', () => {
    // Image / video / embedding don't surface in chat picker
    // regardless of runtime gating — this guard predates P2 and
    // must survive the refactor.
    assert.match(routeSrc, /if\s*\(\s*cap\.media\s*\)\s*return\s+null/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice C — Electron before-quit dispose
// ─────────────────────────────────────────────────────────────────────

describe('Electron before-quit — Codex app-server dispose (Slice C)', () => {
  const electronMainSrc = fs.readFileSync(
    path.join(repoRoot, '..', 'electron', 'main.ts'),
    'utf8',
  );

  it('before-quit handler fetches /api/codex/dispose before killServer', () => {
    // Pin the relative ordering by string indices anchored on the
    // 'before-quit' handler start. Non-greedy regex-extracting the
    // handler block doesn't work — nested })s in the embedded
    // Promise.race / setTimeout closures make the match terminate
    // early on the wrong })s.
    const beforeQuitIdx = electronMainSrc.indexOf("app.on('before-quit'");
    const disposeIdx = electronMainSrc.indexOf('/api/codex/dispose', beforeQuitIdx);
    const killServerIdx = electronMainSrc.indexOf('await killServer()', beforeQuitIdx);
    assert.ok(beforeQuitIdx > 0, "app.on('before-quit') handler must exist");
    assert.ok(disposeIdx > beforeQuitIdx, 'dispose fetch must appear after before-quit handler opens');
    assert.ok(killServerIdx > beforeQuitIdx, 'killServer call must appear in before-quit handler');
    assert.ok(
      disposeIdx < killServerIdx,
      'dispose fetch must come BEFORE killServer (graceful before force-kill)',
    );
  });

  it('dispose fetch has a timeout race so a hang cannot block app exit', () => {
    // 1.5s budget per the route docstring — without this the entire
    // quit waits on a hung fetch, which is worse than the orphan we're
    // trying to prevent.
    assert.match(
      electronMainSrc,
      /Promise\.race\([\s\S]{0,500}\/api\/codex\/dispose[\s\S]{0,500}setTimeout\(/,
    );
  });

  it('/api/codex/dispose route exists and calls disposeCodexAppServer', () => {
    const routeSrc = fs.readFileSync(
      path.join(repoRoot, 'app/api/codex/dispose/route.ts'),
      'utf8',
    );
    assert.match(
      routeSrc,
      /import\s*\{\s*disposeCodexAppServer\s*\}\s*from\s*['"]@\/lib\/codex\/app-server-manager['"]/,
    );
    assert.match(routeSrc, /export\s+async\s+function\s+POST/);
    assert.match(routeSrc, /await\s+disposeCodexAppServer\(\)/);
  });
});
