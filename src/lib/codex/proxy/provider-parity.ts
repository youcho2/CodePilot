/**
 * Phase 5b — Provider parity inventory for the Codex proxy.
 *
 * Answers "which CodePilot providers / models can route through
 * Codex's `codepilot_proxy`?" so the picker UI can render disabled
 * rows with a *specific* reason instead of "Codex doesn't support
 * this model" (the wording Codex CLI smoke users push back on
 * because it implies permanence).
 *
 * Inventory dimensions:
 *
 *   provider_id       DB row id or 'env'.
 *   provider_name     User-visible.
 *   compat            ProviderRuntimeCompat tier.
 *   adapter_status    Per Phase 5b adapter readiness for that compat
 *                     tier — 'ready' / 'pending' / 'not_applicable'.
 *   excluded_reason   Populated when adapter_status !== 'ready'.
 *
 * The contract: for every NON-excluded codepilot_runtime-reachable
 * provider in the DB, the inventory must include an entry. A future
 * provider added to the DB or a future compat tier must trip the
 * `phase-5b-parity-contract` test until the adapter status is set
 * explicitly here.
 */

import type { ApiProvider, ProviderRuntimeCompat } from '@/types';
import { getProviderCompat } from '@/lib/runtime-compat';

/**
 * Per-tier adapter readiness for Phase 5b. Single source of truth.
 * Flip a value to 'ready' as each adapter ships; the picker reads
 * this and stops disabling rows for that tier.
 */
export const ADAPTER_STATUS_BY_COMPAT: Record<ProviderRuntimeCompat, ProxyAdapterStatus> = {
  // Native runtime never goes through the proxy — Codex Account
  // routes through Codex's own app-server, not via codepilot_proxy.
  codex_account: 'not_applicable',
  // Image / video / embedding don't surface in chat picker.
  media_only: 'not_applicable',
  // The three real adapter targets — each flips to 'ready' as Phase
  // 5b sub-commits land. This commit is the foundation; all three
  // still report 'pending' because the translation layer is stubbed.
  claude_code_ready: 'pending',
  claude_code_verified: 'pending',
  claude_code_experimental: 'pending',
  openrouter_anthropic_skin: 'pending',
  codepilot_only: 'pending',
  unknown: 'pending',
};

export type ProxyAdapterStatus = 'ready' | 'pending' | 'not_applicable';

export type AdapterFamily = 'openai_compatible' | 'anthropic_compatible' | 'codeplan' | 'native';

/** Which adapter family a compat tier maps to. */
export const ADAPTER_FAMILY_BY_COMPAT: Record<ProviderRuntimeCompat, AdapterFamily> = {
  // Codex Account routes through Codex natively, never via the proxy.
  codex_account: 'native',
  media_only: 'native',
  // Anthropic-shape wire (proper Messages-API). Phase 5b's
  // Anthropic-compat adapter handles these.
  claude_code_ready: 'anthropic_compatible',
  openrouter_anthropic_skin: 'anthropic_compatible',
  // Verified + experimental are CodePlan / 套餐型 brands speaking
  // Anthropic wire format. Same adapter family as claude_code_ready
  // mechanically but classified separately because they carry
  // brand-specific alias mapping (GLM / Kimi / 百炼 / MiniMax /
  // DeepSeek) that the CodePlan adapter is responsible for honoring.
  claude_code_verified: 'codeplan',
  claude_code_experimental: 'codeplan',
  // OpenAI chat-completions wire.
  codepilot_only: 'openai_compatible',
  // Unknown — best-guess to OpenAI-compatible since chat/completions
  // is the more common third-party shape; adapter surfaces the
  // failure cleanly if it doesn't fit.
  unknown: 'openai_compatible',
};

export interface ProviderParityEntry {
  provider_id: string;
  provider_name: string;
  compat: ProviderRuntimeCompat;
  adapter_family: AdapterFamily;
  adapter_status: ProxyAdapterStatus;
  /** Populated when status !== 'ready'. UI tooltip uses this. */
  excluded_reason?: string;
}

/**
 * Snapshot of the proxy's parity surface for one provider. Pure
 * function — doesn't read the DB; caller passes ApiProvider records
 * in. Picker tooltip + Settings inventory both call this.
 */
export function getProxyParityEntry(provider: ApiProvider): ProviderParityEntry {
  const compat = getProviderCompat({
    provider_type: provider.provider_type,
    base_url: provider.base_url,
  });
  const family = ADAPTER_FAMILY_BY_COMPAT[compat];
  const status = ADAPTER_STATUS_BY_COMPAT[compat];
  return {
    provider_id: provider.id,
    provider_name: provider.name,
    compat,
    adapter_family: family,
    adapter_status: status,
    ...(status === 'ready' || status === 'not_applicable'
      ? {}
      : { excluded_reason: pendingReason(family) }),
  };
}

function pendingReason(family: AdapterFamily): string {
  switch (family) {
    case 'openai_compatible':
      return 'Codex provider proxy: OpenAI-compatible adapter is wiring (Phase 5b in progress).';
    case 'anthropic_compatible':
      return 'Codex provider proxy: Anthropic-compatible adapter is wiring (Phase 5b in progress).';
    case 'codeplan':
      return 'Codex provider proxy: CodePlan / brand-shaped adapter is wiring (Phase 5b in progress).';
    case 'native':
      // Should never be returned — native maps to not_applicable.
      // Defensive fallback.
      return 'Provider does not route through the Codex proxy.';
  }
}

/**
 * Build the bilingual disabled-state copy the chat picker shows on
 * a CodePilot provider model row under Codex Runtime. Each adapter
 * family gets its own line so the user knows WHICH 5b slice they're
 * waiting on, not a generic "support pending".
 */
export function pickerDisabledReason(family: AdapterFamily, isZh: boolean): string {
  if (isZh) {
    switch (family) {
      case 'openai_compatible':
        return 'Codex provider proxy 正在接入 OpenAI 兼容 adapter（Phase 5b）';
      case 'anthropic_compatible':
        return 'Codex provider proxy 正在接入 Anthropic / ClaudeCode 兼容 adapter（Phase 5b）';
      case 'codeplan':
        return 'Codex provider proxy 正在接入 CodePlan / 套餐型 adapter（Phase 5b）';
      case 'native':
        return '该服务商不通过 Codex provider proxy';
    }
  }
  switch (family) {
    case 'openai_compatible':
      return 'Codex provider proxy: OpenAI-compatible adapter is being wired (Phase 5b)';
    case 'anthropic_compatible':
      return 'Codex provider proxy: Anthropic / ClaudeCode-compatible adapter is being wired (Phase 5b)';
    case 'codeplan':
      return 'Codex provider proxy: CodePlan / brand-shaped adapter is being wired (Phase 5b)';
    case 'native':
      return 'This provider does not route through the Codex proxy';
  }
}
