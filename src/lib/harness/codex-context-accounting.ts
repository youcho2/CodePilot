/**
 * Phase 4 — Codex Runtime Context Accounting producer.
 *
 * Per user spec #5: Codex MUST split by providerBackend:
 *   - codex_account     — OAuth登录态; many kinds perception_only/unsupported per Phase 5e
 *   - codepilot_proxy   — user-supplied provider via CodePilot bridge (Phase 5e)
 *   - native_app_server — Codex app-server self-managed (no CodePilot bridge)
 *
 * Per user spec #6: Codex run_completed MUST persist final usage.context_breakdown
 * to the result event (not just live context_usage event). The cache + result
 * event wire lives in `src/lib/codex/runtime.ts` (the producer here is pure).
 *
 * Phase 4 real-source coverage (all three backends):
 *   - rules:    ✅ workspace CLAUDE.md filesize (runtime-agnostic)
 *   - memory:   ❌ unsupported across all backends in Phase 4
 *               (codex_account is permanently perception_only per Phase 5e;
 *                codepilot_proxy bridge supports memory but adapter doesn't
 *                snapshot it yet — Phase 6.x)
 *   - tools / mcp / skills / system_prompt / files_attachments: ❌ unsupported
 *
 * The codex_account vs codepilot_proxy distinction is encoded in
 * `providerBackend`; the snapshot's `unsupported` list is currently the
 * same across backends (rules is the only real source). Future Phase 6.x
 * will surface per-backend deltas (e.g. codepilot_proxy can wire memory
 * via CodePilot bridge but codex_account cannot).
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ContextAccountingEntry,
  ContextAccountingKind,
  RuntimeContextAccountingSnapshot,
} from '@/types';

export type CodexProviderBackend = 'codex_account' | 'codepilot_proxy' | 'native_app_server';

const PHASE_4_UNSUPPORTED: readonly ContextAccountingKind[] = [
  'tools',
  'mcp',
  'memory',
  'system_prompt',
  'files_attachments',
  'skills',
] as const;

export function produceCodexAccountingSnapshot(input: {
  workspacePath: string;
  providerBackend: CodexProviderBackend;
}): RuntimeContextAccountingSnapshot {
  const entries: Partial<Record<ContextAccountingKind, ContextAccountingEntry>> = {};

  // rules — workspace CLAUDE.md filesize (same fs path as ClaudeCode/Native)
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
    unsupported: [...PHASE_4_UNSUPPORTED],
    producedBy: 'codex_runtime',
    providerBackend: input.providerBackend,
  };
}

/**
 * Resolve provider backend from runtime input. `providerId === 'codex_account'`
 * → codex_account; everything else through Codex runtime → codepilot_proxy
 * (because the bridge layer routes user-supplied providers via CodePilot).
 * 'native_app_server' is reserved for future direct-SDK integration.
 */
export function resolveCodexProviderBackend(providerId: string): CodexProviderBackend {
  if (providerId === 'codex_account') return 'codex_account';
  return 'codepilot_proxy';
}
