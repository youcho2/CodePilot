// Phase 5e Phase 3 (2026-05-18) + review round 3 fix P1 #B + round 4
// fix P2 #2 (2026-05-18) — server component derives the capability
// matrix per Runtime using the **effective resolved provider** (the
// same one chat send path uses). The resolver itself lives in
// `src/lib/harness/settings-effective-provider.ts` so it can be unit-
// tested against pinned-invalid + auto-fallback fixtures without
// driving a Next page render.
//
// Using `resolveEffectiveProviderId()` (which internally calls the
// canonical `resolveProvider()` chat send path uses) means the matrix
// reflects the real-world behaviour: pinned-but-invalid + auto
// fallback resolves to the active provider, not to the broken pin.
//
// Server-side derivation isolates the capability-contract → MCP-factory
// → `child_process` dep chain to the server bundle; the browser bundle
// only receives the rendered cell data.

import { RuntimePanel } from "@/components/settings/RuntimePanel";
import {
  buildCapabilityMatrix,
  capabilityMatrixForRuntimeProvider,
} from "@/lib/harness/capability-matrix";
import { resolveEffectiveProviderId } from "@/lib/harness/settings-effective-provider";

export default function SettingsRuntimePage() {
  const providerId = resolveEffectiveProviderId();

  // For claude_code + codepilot_runtime the per-provider override is a
  // no-op (capabilityMatrixForRuntimeProvider returns the runtime-only
  // matrix when no override applies). For codex_runtime + codex_account
  // it demotes bridge-only capabilities to perception_only with a
  // suggested-Runtime hint. Either way the page passes one matrix per
  // Runtime to the panel; the panel renders each as its own card.
  const matrix = buildCapabilityMatrix();
  const codexCells = capabilityMatrixForRuntimeProvider(
    "codex_runtime",
    providerId,
  );

  return (
    <RuntimePanel
      capabilityCells={{
        claude_code: matrix.claude_code,
        codepilot_runtime: matrix.codepilot_runtime,
        codex_runtime: codexCells,
      }}
      currentProviderId={providerId}
    />
  );
}
