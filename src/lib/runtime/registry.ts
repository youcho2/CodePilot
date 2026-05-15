/**
 * runtime/registry.ts — Runtime registration and resolution.
 *
 * Keeps a Map of available runtimes. resolveRuntime() picks the best one
 * based on user settings and CLI binary availability (auto mode).
 *
 * auto 语义（自 0.50.3 起简化为 binary check）：
 *   - 装了 Claude Code CLI → SDK runtime
 *   - 没装 → Native runtime
 *
 * 此前 auto 会综合 env vars / DB provider / ~/.claude/settings.json 做凭据推断，
 * 但推断逻辑在边缘场景（cc-switch 代理占位符、全新未配置用户等）频繁出错，
 * 导致 Sentry NEXT-2Z "No provider credentials" 长期高位。改为二元判定后，
 * 没凭据的场景由 Chat API 入口的 NEEDS_PROVIDER_SETUP 精准拦截，不再由
 * runtime 决策层胡乱猜测。
 */

import type { AgentRuntime } from './types';
import { getSetting } from '@/lib/db';

const runtimes = new Map<string, AgentRuntime>();

export function registerRuntime(runtime: AgentRuntime): void {
  runtimes.set(runtime.id, runtime);
}

export function getRuntime(id: string): AgentRuntime | undefined {
  return runtimes.get(id);
}

export function getAllRuntimes(): AgentRuntime[] {
  return Array.from(runtimes.values());
}

export function getAvailableRuntimes(): AgentRuntime[] {
  return getAllRuntimes().filter(r => r.isAvailable());
}

/**
 * Pick the runtime to use for a given request.
 *
 * Priority (Phase 5 Phase 6 IA correction round 2, 2026-05-14):
 *   0. **Codex Runtime explicit** — `overrideId === 'codex_runtime'`
 *      OR (`overrideId` empty/auto AND stored `agent_runtime === 'codex_runtime'`).
 *      Returns Codex if available. Fall through if unavailable; the chat
 *      send path's fail-closed guardrail (`claude-client.ts` Round 5)
 *      surfaces a clear "Codex Runtime is not available" before any
 *      legacy fallback would activate.
 *   1. `cli_enabled=false` → native (constraint for the LEGACY pair only;
 *      Codex was already routed above, so its own subprocess isn't gated
 *      by the Claude CLI toggle).
 *   2. Explicit override (other than codex_runtime).
 *   3. Global user setting (other than codex_runtime).
 *   4. Auto: SDK if CLI binary exists, else native.
 *
 * Why the codex check comes FIRST: pre-round-2, `cli_enabled=false` was
 * treated as the absolute override. Selecting Codex Runtime as the
 * global default in Settings → Runtime saved `agent_runtime='codex_runtime'`
 * AND `cli_enabled='false'` (Codex doesn't need the Claude CLI), and
 * the absolute-override branch then hijacked the resolution back to
 * native. Settings page said "Codex Runtime current default" while the
 * Models page filter ran on `codepilot_runtime` and showed 42 non-Codex
 * models — exactly the misroute the user caught.
 */
export function resolveRuntime(overrideId?: string, _providerId?: string): AgentRuntime {
  const settingId = getSetting('agent_runtime');

  // 0. Codex Runtime explicit (override or stored setting) — beats cli_enabled.
  const wantsCodex =
    overrideId === 'codex_runtime'
    || ((!overrideId || overrideId === 'auto') && settingId === 'codex_runtime');
  if (wantsCodex) {
    const codex = getRuntime('codex_runtime');
    if (codex?.isAvailable()) return codex;
    // Fall through if Codex isn't registered / unavailable. The chat
    // send path (streamClaude) and provider resolver gate this earlier
    // for `codex_account` providers; we don't try to fall back to a
    // legacy runtime here because Codex Account models can't run on
    // anything else (different wire format).
  }

  // 1. cli_enabled=false now ONLY constrains the legacy claude-code-sdk ↔
  //    native pair. Codex was handled above; this no longer hijacks codex.
  const cliDisabled = getSetting('cli_enabled') === 'false';
  if (cliDisabled) {
    const native = getRuntime('native');
    if (native) return native;
    throw new Error('Native runtime not registered but CLI is disabled. This is a bug.');
  }

  // 2. Explicit override (other than codex_runtime, handled above)
  if (overrideId && overrideId !== 'auto') {
    const r = getRuntime(overrideId);
    if (r?.isAvailable()) return r;
  }

  // 3. Global setting (other than codex_runtime, handled above)
  if (settingId && settingId !== 'auto') {
    const r = getRuntime(settingId);
    if (r?.isAvailable()) return r;
  }

  // 4. Auto: CLI installed → SDK, otherwise Native.
  //    No credential inference — missing credentials are caught earlier at
  //    /api/chat by hasCodePilotProvider(); if we reach this point the user
  //    has at least one provider source the caller expects to work.
  const sdk = getRuntime('claude-code-sdk');
  if (sdk?.isAvailable()) return sdk;

  const native = getRuntime('native');
  if (native?.isAvailable()) return native;

  // Last resort: return native even if "unavailable" — it only needs an API key,
  // and will produce a clear error message if credentials are missing.
  if (native) return native;

  throw new Error('No agent runtime registered. This is a bug — please report it.');
}

/**
 * Predict whether the native runtime will be used for a given request.
 *
 * Mirrors resolveRuntime() logic WITHOUT instantiating the runtime, so callers
 * (chat route, bridge) can prepare the right MCP config upfront.
 *
 * @param providerId - The provider for this request. `'codex_account'`
 *   forces Codex Runtime (returns false); `'openai-oauth'` is Native-only
 *   UNLESS the global default is `codex_runtime`, in which case it routes
 *   through Codex's proxy (Phase 5b — Codex's Responses-API wire format
 *   matches openai-oauth exactly, so the proxy adapter handles it via
 *   the OpenAI OAuth virtual-provider branch in ai-provider.ts).
 */
export function predictNativeRuntime(providerId?: string): boolean {
  // Phase 5 Phase 6 IA correction round 2 (2026-05-14) — codex_account
  // provider routes to Codex Runtime, NOT native. Same for an explicit
  // codex_runtime setting; cli_enabled=false doesn't downgrade Codex.
  if (providerId === 'codex_account') return false;
  const settingId = getSetting('agent_runtime');
  if (settingId === 'codex_runtime') return false;

  // Phase 5b follow-up (2026-05-15) — openai-oauth was historically
  // pinned to native because Claude Code SDK can't speak OpenAI's
  // wire format. Under Codex Runtime the proxy DOES handle it (Codex
  // speaks the same Responses-API the openai-oauth path uses). The
  // codex_runtime branch above already short-circuits when the global
  // default is Codex; the check here covers the residual case where
  // openai-oauth is the active provider and the global isn't Codex.
  if (providerId === 'openai-oauth') return true;

  // cli_enabled=false → native for the legacy pair (codex already handled)
  if (getSetting('cli_enabled') === 'false') return true;

  // Explicit setting — but verify SDK is actually usable
  if (settingId === 'native') return true;
  if (settingId === 'claude-code-sdk') {
    // If CLI doesn't exist, explicit selection will fallback to native at runtime
    const sdk = getRuntime('claude-code-sdk');
    return !sdk?.isAvailable();
  }

  // Auto: CLI installed → SDK (native=false), otherwise Native (native=true)
  const sdk = getRuntime('claude-code-sdk');
  return !sdk?.isAvailable();
}
