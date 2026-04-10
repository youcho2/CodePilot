/**
 * runtime/registry.ts — Runtime registration and resolution.
 *
 * Keeps a Map of available runtimes. resolveRuntime() picks the best one
 * based on user settings and availability.
 */

import type { AgentRuntime } from './types';
import { getSetting, getActiveProvider } from '../db';

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
 * Check if Anthropic-compatible credentials exist (for auto-mode SDK preference).
 * This is intentionally broad — CLI manages its own auth in many ways.
 */
// Protocols that the Claude Code SDK subprocess can actually serve
const SDK_COMPATIBLE_PROTOCOLS = new Set(['anthropic', 'bedrock', 'vertex']);

function hasAnthropicCredentials(): boolean {
  // Env vars (always Anthropic-targeted)
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  // Legacy DB setting
  if (getSetting('anthropic_auth_token')) return true;
  // Active provider with SDK-compatible protocol (not GLM, Kimi, OpenAI etc.)
  try {
    const provider = getActiveProvider();
    if (provider) {
      const protocol = provider.protocol || provider.provider_type || '';
      if (SDK_COMPATIBLE_PROTOCOLS.has(protocol) && provider.api_key) return true;
      // Bedrock/Vertex: env_only auth, no api_key needed
      const extraEnv = provider.extra_env || '{}';
      if (extraEnv.includes('CLAUDE_CODE_USE_BEDROCK') || extraEnv.includes('CLAUDE_CODE_USE_VERTEX')) return true;
    }
  } catch { /* DB not ready */ }
  return false;
}

/**
 * Pick the runtime to use for a given request.
 *
 * Priority:
 * 0. cli_enabled=false → ALWAYS use native (highest-priority constraint)
 * 1. Explicit override (from function arg or per-session setting)
 * 2. Global user setting (agent_runtime)
 * 3. Auto: native if available, else claude-code-sdk
 */
export function resolveRuntime(overrideId?: string): AgentRuntime {
  // 0. cli_enabled=false is an absolute constraint — never return SDK
  const cliDisabled = getSetting('cli_enabled') === 'false';

  if (cliDisabled) {
    const native = getRuntime('native');
    if (native) return native;
    throw new Error('Native runtime not registered but CLI is disabled. This is a bug.');
  }

  // 1. Explicit override
  if (overrideId && overrideId !== 'auto') {
    const r = getRuntime(overrideId);
    if (r?.isAvailable()) return r;
  }

  // 2. Global setting
  const settingId = getSetting('agent_runtime');
  if (settingId && settingId !== 'auto') {
    const r = getRuntime(settingId);
    if (r?.isAvailable()) return r;
  }

  // 3. Auto: prefer SDK only if CLI exists AND Anthropic credentials are available.
  //    Without Anthropic creds (e.g. user only has GLM/OpenAI), SDK subprocess
  //    will fail — use native runtime instead (#456).
  //    Note: isAvailable() only checks CLI binary. The credential check is here
  //    because CLI manages its own auth in many ways (OAuth, env, provider),
  //    and we only need this guard for AUTO mode, not explicit selection.
  const sdk = getRuntime('claude-code-sdk');
  if (sdk?.isAvailable() && hasAnthropicCredentials()) return sdk;

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
 * This mirrors resolveRuntime() logic WITHOUT actually instantiating the runtime,
 * so callers (chat route, bridge) can prepare the right MCP config upfront.
 *
 * @param providerId - The provider for this request ('openai-oauth' forces native)
 */
export function predictNativeRuntime(providerId?: string): boolean {
  // Non-Anthropic providers always force native
  if (providerId === 'openai-oauth') return true;

  // cli_enabled=false → always native
  if (getSetting('cli_enabled') === 'false') return true;

  // Explicit setting — but verify SDK is actually usable
  const settingId = getSetting('agent_runtime');
  if (settingId === 'native') return true;
  if (settingId === 'claude-code-sdk') {
    // If CLI doesn't exist, explicit selection will fallback to native at runtime
    const sdk = getRuntime('claude-code-sdk');
    return !sdk?.isAvailable();
  }

  // Auto: prefer SDK if CLI exists AND has Anthropic credentials
  const sdk = getRuntime('claude-code-sdk');
  if (sdk?.isAvailable() && hasAnthropicCredentials()) return false;

  return true; // SDK not available or no Anthropic creds → native
}
