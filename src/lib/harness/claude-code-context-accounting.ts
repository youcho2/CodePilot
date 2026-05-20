/**
 * Phase 2 — ClaudeCode Runtime's Context Accounting producer.
 *
 * Real-source coverage (vs Phase 6 Tier 2 假数据):
 *   - skills:   ✅ structured `selectedSkills` from MessageInput badges
 *               → discoverSkills().find(s => s.name === label).filePath
 *               → fs.statSync filesize char/4
 *               Covers project / global / installed / plugin skills.
 *   - rules:    ✅ workspace CLAUDE.md filesize
 *   - tools / mcp / memory / system_prompt / files_attachments: ❌ unsupported
 *
 * Codex review v3 (2026-05-20) P1 fix: the previous regex on `userPrompt`
 * only matched `/skill-name`手打路径. Real UI badge dispatch produces
 * `Use the <name> skill. User context: ...` (see
 * `src/lib/message-input-logic.ts:dispatchBadge` agent_skill branch), so
 * users selecting Agent Skill via the input UI got Skills row hidden.
 *
 * Fix: producer no longer parses prompt text. Caller MUST pass
 * `selectedSkills: string[]` containing the badge-derived skill names.
 * Producer looks each up via `discoverSkills()` which covers project
 * `.claude/skills/`, user `~/.claude/skills/`, and `~/.agents/skills/`.
 * If `selectedSkills` is empty or names don't resolve → skills entry omit.
 *
 * `userPrompt` is retained on the input shape for future structural
 * signals (e.g. MCP tool invocation parse from prompt) but is NOT used
 * for skill detection in this phase.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ContextAccountingEntry,
  ContextAccountingKind,
  RuntimeContextAccountingSnapshot,
} from '@/types';
import { discoverSkills } from '@/lib/skill-discovery';

const PHASE_2_UNSUPPORTED: readonly ContextAccountingKind[] = [
  'tools',
  'mcp',
  'memory',
  'system_prompt',
  'files_attachments',
] as const;

/** Token estimator — same char/4 heuristic the compiler uses. */
function estimateTokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

/** Map a discovered skill's filePath to a stable, workspace-relative
 *  source breadcrumb. Falls back to absolute path for outside-workspace
 *  installs (e.g. plugin / global skills). */
function formatSkillSource(workspacePath: string, filePath: string): string {
  const rel = path.relative(workspacePath, filePath);
  // path.relative returns something like '.claude/skills/...' for
  // workspace-rooted skills, and '../../home/user/.claude/skills/...'
  // for outside-workspace. Prefer the relative form when it's clean.
  if (!rel.startsWith('..')) return `workspace/${rel}`;
  // outside workspace — use absolute path; UI tooltip can show the full path
  return filePath;
}

/**
 * Phase 2 ClaudeCode producer. Caller (claude-client.ts streamClaude)
 * passes `selectedSkills` derived from MessageInput's agent_skill badge
 * metadata; this avoids guessing from final-prompt text.
 */
export function produceClaudeCodeAccountingSnapshot(input: {
  workspacePath: string;
  /** Final prompt sent to SDK. Currently unused by skill detection
   *  (Codex review v3 P1 fix removed regex), retained for future signals. */
  userPrompt: string;
  /** Skill names from MessageInput agent_skill badges. When empty,
   *  skills entry is omitted (no slash-command fallback — per user spec
   *  "不要从 final prompt 文本猜 Skill"). */
  selectedSkills?: readonly string[];
}): RuntimeContextAccountingSnapshot {
  const entries: Partial<Record<ContextAccountingKind, ContextAccountingEntry>> = {};

  // -- skills (structured badge metadata + skill-discovery lookup) --
  if (input.selectedSkills && input.selectedSkills.length > 0) {
    let totalTokens = 0;
    const matchedNames: string[] = [];
    const sources: string[] = [];
    let allSkills: ReturnType<typeof discoverSkills> = [];
    try {
      allSkills = discoverSkills(input.workspacePath);
    } catch {
      // discoverSkills failed — entries.skills will be omitted below
    }
    for (const name of input.selectedSkills) {
      const skill = allSkills.find((s) => s.name === name);
      if (!skill || !skill.filePath) continue;
      try {
        const stat = fs.statSync(skill.filePath);
        totalTokens += estimateTokensFromBytes(stat.size);
        matchedNames.push(name);
        sources.push(formatSkillSource(input.workspacePath, skill.filePath));
      } catch {
        // skill file missing on disk despite discovery — skip silently
      }
    }
    if (totalTokens > 0) {
      entries.skills = {
        tokens: totalTokens,
        source: sources.length === 1 ? sources[0] : sources.join(' + '),
        detail: matchedNames.join(', '),
      };
    }
  }

  // -- rules (workspace CLAUDE.md filesize) --
  const claudeMdPath = path.join(input.workspacePath, 'CLAUDE.md');
  try {
    const stat = fs.statSync(claudeMdPath);
    entries.rules = {
      tokens: estimateTokensFromBytes(stat.size),
      source: 'workspace/CLAUDE.md',
      detail: 'CLAUDE.md',
    };
  } catch {
    // CLAUDE.md missing — entries.rules omitted (UI hides)
  }

  return {
    entries,
    unsupported: [...PHASE_2_UNSUPPORTED],
    producedBy: 'claude_code',
  };
}
