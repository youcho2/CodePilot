/**
 * Phase 5 Phase 6 (2026-05-14) — source-level pin for Settings收口.
 *
 * Three wiring surfaces are load-bearing for the Codex visibility
 * pass; if any silently regresses the user is back to "Codex looks
 * configured but my model picker / chat send / app exit misbehaves":
 *
 *   1. Settings registers a `codex` section: nav-config + page +
 *      panel + i18n keys, all in lockstep.
 *   2. Chat model picker shows codex_runtime-specific disclosure +
 *      empty-state copy (per user spec 2026-05-14: filter, not
 *      gray-out; "切回 Claude Code / CodePilot Runtime" wording).
 *   3. Electron `before-quit` hook calls /api/codex/dispose before
 *      `killServer()` (avoids orphan Codex grandchild).
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
// Slice A — Settings Codex section
// ─────────────────────────────────────────────────────────────────────

describe('Settings nav-config — codex section registration (Slice A)', () => {
  const navSrc = fs.readFileSync(
    path.join(repoRoot, 'components/settings/nav-config.ts'),
    'utf8',
  );

  it('SettingsSection union includes "codex"', () => {
    assert.match(navSrc, /\|\s*['"]codex['"]/);
  });

  it('SETTINGS_NAV_ITEMS contains a codex entry with /settings/codex href', () => {
    assert.match(
      navSrc,
      /id:\s*['"]codex['"][\s\S]{0,200}href:\s*['"]\/settings\/codex['"]/,
    );
  });

  it('codex nav entry is ordered after runtime (runtime-tier extension)', () => {
    const runtimeIdx = navSrc.indexOf('id: "runtime"');
    const codexIdx = navSrc.indexOf('id: "codex"');
    assert.ok(runtimeIdx > 0, 'runtime nav entry exists');
    assert.ok(codexIdx > runtimeIdx, 'codex nav entry must come after runtime');
  });

  it('codex i18n key is registered in en + zh', () => {
    const enSrc = fs.readFileSync(path.join(repoRoot, 'i18n/en.ts'), 'utf8');
    const zhSrc = fs.readFileSync(path.join(repoRoot, 'i18n/zh.ts'), 'utf8');
    assert.match(enSrc, /['"]settings\.codex['"]\s*:\s*['"]Codex['"]/);
    assert.match(zhSrc, /['"]settings\.codex['"]\s*:\s*['"]Codex['"]/);
  });
});

describe('Settings Codex section files exist (Slice A)', () => {
  it('src/app/settings/codex/page.tsx exists and exports SettingsCodexPage', () => {
    const pageSrc = fs.readFileSync(
      path.join(repoRoot, 'app/settings/codex/page.tsx'),
      'utf8',
    );
    assert.match(pageSrc, /export\s+default\s+function\s+SettingsCodexPage/);
    assert.match(pageSrc, /from\s+["']@\/components\/settings\/CodexPanel["']/);
  });

  it('CodexPanel reads from the three Codex APIs (no schema changes)', () => {
    const panelSrc = fs.readFileSync(
      path.join(repoRoot, 'components/settings/CodexPanel.tsx'),
      'utf8',
    );
    assert.match(panelSrc, /\/api\/codex\/status/);
    assert.match(panelSrc, /\/api\/codex\/account/);
    assert.match(panelSrc, /\/api\/codex\/models/);
    assert.match(panelSrc, /\/api\/codex\/login/);
  });

  it('CodexPanel does not auto-open external URLs (user must click)', () => {
    // Per `feedback_no_silent_auto_irreversible.md` — the login flow's
    // authUrl is rendered as an explicit <a target="_blank"> link,
    // not a window.open() side effect.
    const panelSrc = fs.readFileSync(
      path.join(repoRoot, 'components/settings/CodexPanel.tsx'),
      'utf8',
    );
    assert.doesNotMatch(panelSrc, /window\.open\(/);
    assert.match(panelSrc, /target=["']_blank["']/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slice B — model picker filter + disclosure
// ─────────────────────────────────────────────────────────────────────

describe('Model picker — codex_runtime disclosure (Slice B)', () => {
  const pickerSrc = fs.readFileSync(
    path.join(repoRoot, 'components/chat/ModelSelectorDropdown.tsx'),
    'utf8',
  );

  it('disclosure branch fires when runtimeApplied === codex_runtime', () => {
    assert.match(pickerSrc, /runtimeApplied\s*===\s*['"]codex_runtime['"]/);
  });

  it('codex_runtime disclosure copy names "Codex Account 模型" + recovery action', () => {
    // The user-spec wording — both halves must be present so users
    // know what's available AND how to escape the filter.
    assert.match(pickerSrc, /Codex Account 模型/);
    assert.match(pickerSrc, /Codex Account models/);
    assert.match(
      pickerSrc,
      /切回\s*Claude Code\s*或\s*CodePilot\s*执行引擎/,
    );
    assert.match(
      pickerSrc,
      /Switch to Claude Code or CodePilot Runtime/,
    );
  });

  it('empty-state under codex_runtime points users to Settings → Codex', () => {
    // Generic "No models available" is unactionable for codex_runtime —
    // the user needs to know to check login. Point at /settings/codex.
    // The empty branch + codex_runtime check + recovery pointer can sit
    // far apart inside the JSX block, so we pin them as three separate
    // asserts + verify ordering via indexOf.
    const emptyStateIdx = pickerSrc.indexOf('providerGroups.length === 0');
    const codexBranchIdx = pickerSrc.indexOf("runtimeApplied === 'codex_runtime'", emptyStateIdx);
    const zhPointerIdx = pickerSrc.indexOf('设置 → Codex', codexBranchIdx);
    assert.ok(emptyStateIdx > 0, 'empty-state branch exists');
    assert.ok(codexBranchIdx > emptyStateIdx, 'codex_runtime branch lives inside the empty-state block');
    assert.ok(zhPointerIdx > codexBranchIdx, 'zh empty-state copy points at 设置 → Codex');
    assert.match(pickerSrc, /Settings\s*→\s*Codex/);
  });

  it('non-codex runtimes retain the generic disclosure copy', () => {
    // The original "Models available under the current Agent engine"
    // wording must still fire for claude_code / codepilot_runtime so
    // those flows aren't accidentally regressed.
    assert.match(
      pickerSrc,
      /Models available under the current Agent engine/,
    );
    assert.match(pickerSrc, /仅显示当前 Agent 引擎可用的模型/);
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
