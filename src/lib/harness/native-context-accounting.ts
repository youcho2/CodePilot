/**
 * Phase 3 — CodePilot Native Runtime (agent-loop.ts) Context Accounting producer.
 *
 * Native runtime is the self-built AI-SDK-based loop (`src/lib/agent-loop.ts`).
 * Per user spec #5: Native MUST explicitly declare unsupported, not show 0
 * or placeholder. Most kinds are unsupported in Phase 3:
 *   - tools / mcp: ai-sdk Options.tools and MCP server schemas aren't
 *     exposed to the snapshot path yet — Phase 6.x can wire when the
 *     harness bundle surfaces schema tokens
 *   - skills: Native uses slash-command + .claude/skills/ same as ClaudeCode,
 *     but the user prompt isn't available at snapshot time (agent-loop sees
 *     the running turn, not the raw prompt). Wire when input parameter
 *     surfaces userPrompt — Phase 6.x.
 *   - system_prompt / memory / files_attachments: same architectural
 *     limit as ClaudeCode (Phase 2 docstring)
 *
 * Phase 3 real-source coverage:
 *   - rules:    ✅ workspace CLAUDE.md filesize (workspace-level, runtime-agnostic)
 *   - others:   ❌ unsupported (declared via `unsupported` array; UI hides)
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ContextAccountingEntry,
  ContextAccountingKind,
  RuntimeContextAccountingSnapshot,
} from '@/types';

const PHASE_3_UNSUPPORTED: readonly ContextAccountingKind[] = [
  'tools',
  'mcp',
  'memory',
  'system_prompt',
  'files_attachments',
  'skills',
] as const;

export function produceNativeAccountingSnapshot(input: {
  workspacePath: string;
}): RuntimeContextAccountingSnapshot {
  const entries: Partial<Record<ContextAccountingKind, ContextAccountingEntry>> = {};

  // rules — workspace CLAUDE.md filesize
  try {
    const stat = fs.statSync(path.join(input.workspacePath, 'CLAUDE.md'));
    entries.rules = {
      tokens: Math.ceil(stat.size / 4),
      source: 'workspace/CLAUDE.md',
      detail: 'CLAUDE.md',
    };
  } catch {
    // CLAUDE.md missing — entries.rules omitted
  }

  return {
    entries,
    unsupported: [...PHASE_3_UNSUPPORTED],
    producedBy: 'codepilot_runtime',
  };
}
