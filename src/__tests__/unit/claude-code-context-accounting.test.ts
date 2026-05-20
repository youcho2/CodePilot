/**
 * Phase 2 — ClaudeCode adapter producer tests.
 *
 * Pins the contract requirement: plain message vs skill-invocation
 * message MUST produce different snapshots (no 假数据).
 *
 * Codex review v3 P1 (2026-05-20) — added real-badge-dispatch regression
 * tests. Producer now reads structured `selectedSkills` (not prompt text).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  produceClaudeCodeAccountingSnapshot,
  canonicalizeSkillName,
} from '../../lib/harness/claude-code-context-accounting';
import { dispatchBadge } from '../../lib/message-input-logic';

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setupWorkspace(opts: {
  claudeMdContent?: string;
  skills?: Record<string, string>;
}): string {
  const ws = mkdtemp('phase2-ws-');
  if (opts.claudeMdContent !== undefined) {
    fs.writeFileSync(path.join(ws, 'CLAUDE.md'), opts.claudeMdContent);
  }
  if (opts.skills) {
    const skillsDir = path.join(ws, '.claude', 'skills');
    for (const [name, content] of Object.entries(opts.skills)) {
      const dir = path.join(skillsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      // Skill frontmatter so discoverSkills picks up the name. Minimal
      // valid SkillDefinition: name + body.
      const skillMd = `---\nname: ${name}\ndescription: test skill\n---\n${content}`;
      fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
    }
  }
  return ws;
}

describe('produceClaudeCodeAccountingSnapshot — Phase 2 ClaudeCode adapter', () => {
  it('plain "你好" (no selectedSkills): skills entry omitted, rules from CLAUDE.md if present', () => {
    const ws = setupWorkspace({
      claudeMdContent: 'CodePilot project rules: do X, Y, Z.',
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: '你好',
      selectedSkills: undefined,
    });

    // No selectedSkills → skills omitted (UI hide via hideZero default)
    assert.equal(snap.entries.skills, undefined);

    // CLAUDE.md exists → rules entry with workspace source
    assert.ok(snap.entries.rules);
    assert.ok(snap.entries.rules.tokens > 0);
    assert.equal(snap.entries.rules.source, 'workspace/CLAUDE.md');

    // Phase 2 unsupported list pinned
    assert.deepEqual([...snap.unsupported].sort(), [
      'files_attachments',
      'mcp',
      'memory',
      'system_prompt',
      'tools',
    ]);

    assert.equal(snap.producedBy, 'claude_code');
  });

  it('selectedSkills=["humanizer-zh"]: skills entry present with SKILL.md filesize via discoverSkills', () => {
    const skillBody = '# Humanizer ZH\n\nRewrite AI-generated Chinese to read more naturally...';
    const ws = setupWorkspace({
      skills: { 'humanizer-zh': skillBody },
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: 'whatever',
      selectedSkills: ['humanizer-zh'],
    });

    assert.ok(snap.entries.skills, 'expected skills entry');
    assert.ok(snap.entries.skills.tokens > 0);
    assert.ok(snap.entries.skills.source.includes('.claude/skills/humanizer-zh/SKILL.md'));
    assert.equal(snap.entries.skills.detail, 'humanizer-zh');
  });

  it('plain vs Skill-badge-dispatched messages produce DIFFERENT snapshots (Codex P1 regression)', () => {
    // This regression test pins the Codex v3 P1 fix: previous regex only
    // matched manually-typed '/humanizer-zh', missing the real badge
    // dispatch path. We now use dispatchBadge's actual output AND pass
    // the structured selectedSkills channel.
    const skillBody = 'skill body content for testing';
    const ws = setupWorkspace({
      claudeMdContent: 'rules',
      skills: { 'humanizer-zh': skillBody },
    });

    // Plain message — no badges, no selectedSkills
    const plain = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: '你好',
      selectedSkills: undefined,
    });

    // Real Skill-badge dispatch — what MessageInput actually sends
    const dispatched = dispatchBadge(
      [{
        kind: 'agent_skill',
        label: 'humanizer-zh',
        command: 'humanizer-zh',
        description: 'rewrite Chinese',
      }],
      '改写',
    );
    // dispatchBadge prompt is "Use the humanizer-zh skill. User context: 改写"
    assert.ok(dispatched.prompt.includes('Use the humanizer-zh skill'));
    assert.ok(!dispatched.prompt.startsWith('/'), 'real dispatch is NOT a slash command');

    const invoked = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: dispatched.prompt,
      selectedSkills: ['humanizer-zh'],
    });

    // Plain has no skills entry; invoked does — the snapshots MUST differ
    assert.equal(plain.entries.skills, undefined);
    assert.ok(invoked.entries.skills, 'badge-dispatch must surface skills entry');
    assert.ok(invoked.entries.skills.tokens > 0);

    // Rules same (CLAUDE.md unchanged across both)
    assert.equal(plain.entries.rules?.tokens, invoked.entries.rules?.tokens);
  });

  it('selectedSkills with multi-skill labels: tokens aggregate across all matched SKILL.md', () => {
    const bodyA = 'skill A body content';
    const bodyB = 'skill B body different content';
    const ws = setupWorkspace({
      skills: { 'skill-a': bodyA, 'skill-b': bodyB },
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: 'whatever',
      selectedSkills: ['skill-a', 'skill-b'],
    });
    assert.ok(snap.entries.skills);
    // Aggregate must equal sum of both filesizes (char/4)
    const expectedA = Math.ceil(fs.statSync(path.join(ws, '.claude/skills/skill-a/SKILL.md')).size / 4);
    const expectedB = Math.ceil(fs.statSync(path.join(ws, '.claude/skills/skill-b/SKILL.md')).size / 4);
    assert.equal(snap.entries.skills.tokens, expectedA + expectedB);
    // Source concatenates both paths
    assert.ok(snap.entries.skills.source.includes('skill-a'));
    assert.ok(snap.entries.skills.source.includes('skill-b'));
    assert.equal(snap.entries.skills.detail, 'skill-a, skill-b');
  });

  it('selectedSkills with unknown label: skills entry omitted (not fake)', () => {
    const ws = setupWorkspace({});
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: 'whatever',
      selectedSkills: ['no-such-skill'],
    });
    assert.equal(snap.entries.skills, undefined);
  });

  it('manually-typed /skill-name in prompt with NO selectedSkills: skills entry omitted (no fallback)', () => {
    // Per Codex v3 P1: producer no longer parses prompt text. If caller
    // doesn't pass structured selectedSkills, Skills row stays hidden
    // even when prompt contains "/humanizer-zh" — power users typing
    // slash commands by hand get hide (not fake).
    const ws = setupWorkspace({
      skills: { 'humanizer-zh': 'body' },
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: '/humanizer-zh 改写',
      selectedSkills: undefined,
    });
    assert.equal(snap.entries.skills, undefined);
  });

  it('workspace without CLAUDE.md: rules entry omitted', () => {
    const ws = setupWorkspace({});
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: 'hi',
    });
    assert.equal(snap.entries.rules, undefined);
  });

  // ====================================================================
  // Codex review v5 P1 regression tests (2026-05-20) — real UI smoke
  // failed because badge picker stores `command: '/humanizer-zh'` but
  // SkillDefinition.name from frontmatter is `humanizer-zh`. Producer
  // must canonicalize incoming names.
  // ====================================================================

  it('canonicalizeSkillName: strips leading slashes + trims', () => {
    assert.equal(canonicalizeSkillName('humanizer-zh'), 'humanizer-zh');
    assert.equal(canonicalizeSkillName('/humanizer-zh'), 'humanizer-zh');
    assert.equal(canonicalizeSkillName('//humanizer-zh'), 'humanizer-zh');
    assert.equal(canonicalizeSkillName('  /humanizer-zh  '), 'humanizer-zh');
    assert.equal(canonicalizeSkillName(''), '');
    assert.equal(canonicalizeSkillName('/'), '');
  });

  it('selectedSkills with leading slash "/humanizer-zh" still resolves (real UI badge value)', () => {
    // This is the EXACT regression Codex v5 P1 caught — real UI smoke
    // produced selectedSkills: ['/humanizer-zh'] from badge picker,
    // producer's previous strict-equality lookup missed the SKILL.md.
    const skillBody = 'humanizer skill body';
    const ws = setupWorkspace({
      skills: { 'humanizer-zh': skillBody },
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: 'whatever',
      selectedSkills: ['/humanizer-zh'],
    });
    assert.ok(snap.entries.skills, 'slash-prefixed name must resolve to SKILL.md');
    assert.ok(snap.entries.skills.tokens > 0);
    // Detail uses the canonical frontmatter name (no slash) so popover
    // copy stays consistent regardless of UI badge form.
    assert.equal(snap.entries.skills.detail, 'humanizer-zh');
  });

  it('selectedSkills case-mismatch resolves via case-insensitive lookup', () => {
    const ws = setupWorkspace({
      skills: { 'humanizer-zh': 'body' },
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: 'whatever',
      selectedSkills: ['HUMANIZER-ZH'],
    });
    assert.ok(snap.entries.skills);
    assert.equal(snap.entries.skills.detail, 'humanizer-zh');
  });

  it('selectedSkills with stray whitespace + multiple slashes: defensive canonicalize', () => {
    const ws = setupWorkspace({
      skills: { 'humanizer-zh': 'body' },
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: 'whatever',
      selectedSkills: ['  //humanizer-zh  '],
    });
    assert.ok(snap.entries.skills);
  });

  it('selectedSkills = ["/"] (slash-only after trim): no entry (no crash)', () => {
    const ws = setupWorkspace({
      skills: { 'humanizer-zh': 'body' },
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: 'whatever',
      selectedSkills: ['/', '   ', ''],
    });
    assert.equal(snap.entries.skills, undefined);
  });

  it('source breadcrumb format pins "workspace/.../" prefix for traceability', () => {
    const ws = setupWorkspace({
      claudeMdContent: 'rules',
      skills: { 'humanizer-zh': 'skill body' },
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: 'whatever',
      selectedSkills: ['humanizer-zh'],
    });
    assert.ok(snap.entries.skills?.source.startsWith('workspace/.claude/skills/'));
    assert.ok(snap.entries.rules?.source.startsWith('workspace/'));
  });
});
