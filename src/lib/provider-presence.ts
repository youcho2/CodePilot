/**
 * provider-presence.ts — Single-source-of-truth: "does CodePilot itself have
 * a usable provider to talk to a model with?"
 *
 * Scope (intentionally narrow, by user requirement 2026-04-15):
 *   - DB provider records with usable auth (api_key, Bedrock/Vertex flag)
 *   - process.env.ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
 *   - Legacy DB setting `anthropic_auth_token`
 *   - OpenAI OAuth session (virtual provider, no DB record required)
 *   - Claude Code CLI login, but ONLY when the SDK runtime will serve the
 *     send (added 2026-07-27). When `claude` is installed and the runtime
 *     isn't forced to Native/Codex, the SDK subprocess reuses whatever the
 *     CLI is authenticated with (macOS Keychain OAuth, ~/.claude/.credentials,
 *     a corporate proxy gateway, env vars, …). We DON'T try to detect that
 *     auth here — the Keychain path has no file to stat, and past attempts to
 *     infer CLI credentials are exactly what made this check unreliable — so
 *     we defer auth to the subprocess: an SDK-capable runtime with the binary
 *     present is treated as a usable provider. A genuinely logged-out CLI then
 *     surfaces a clear, specific error from the subprocess instead of the
 *     generic pre-block. This mirrors `sdk-runtime.isAvailable()`'s own stated
 *     philosophy ("auth is managed by the CLI, should fail at runtime with a
 *     clear error, not be pre-filtered here").
 *
 * Out of scope (intentionally NOT checked):
 *   - The `~/.claude/settings.json` env block (cc-switch, hand-edit) is still
 *     NOT read here: cc-switch proxy PLACEHOLDERS lived in that block and
 *     produced false positives. It's the CLI's file; the subprocess loads it
 *     on its own when the SDK runtime runs (see the in-scope note above).
 *
 * Used by:
 *   - `/api/chat` entry precheck (412 + NEEDS_PROVIDER_SETUP when false)
 *   - `/api/setup` Provider card status (kept in lockstep to avoid the
 *     "intercepted at chat but setup shows green" skew)
 *   - ProviderCard consumes `/api/setup` output, so it inherits the same
 *     judgement transitively.
 */

import type { ApiProvider } from '@/types';
import { getSetting, getAllProviders } from '@/lib/db';
import { isOAuthUsable } from '@/lib/openai-oauth-manager';
import { isXaiOAuthUsable } from '@/lib/xai-oauth-manager';
import { findClaudeBinary } from '@/lib/platform';

/**
 * Test seam: probe for "is the Claude Code CLI binary installed?". Production
 * delegates to platform.findClaudeBinary() (60s-cached; the same probe
 * resolveRuntime() runs on every send). Unit tests override it so a CI / dev
 * box that happens to have `claude` on PATH can't flip the clean-install
 * assertions. Pass null to restore the real probe.
 */
let sdkBinaryProbe: () => boolean = () => !!findClaudeBinary();
export function __setSdkBinaryProbeForTests(fn: (() => boolean) | null): void {
  sdkBinaryProbe = fn ?? (() => !!findClaudeBinary());
}

/**
 * True when the Claude Code SDK runtime will serve a *default* (no per-request
 * override) send: the `claude` binary exists and neither the global runtime
 * setting nor the legacy cli toggle forces us onto Native / Codex.
 *
 * Mirrors the auto/global branch of resolveRuntime() (runtime/registry.ts)
 * WITHOUT importing the registry — provider-presence sits under /api/chat's
 * hot path and the registry barrel pulls in claude-client, so a direct import
 * risks the claude-client ⇄ runtime init cycle. Session-level pins can still
 * override the runtime per request; this coarse gate only needs the global
 * picture, same as every other credential source in hasCodePilotProvider().
 */
function claudeCodeSdkWillRun(): boolean {
  const setting = getSetting('agent_runtime') || 'auto';
  if (setting === 'native' || setting === 'codex_runtime') return false;
  if (getSetting('cli_enabled') === 'false') return false;
  // 'auto' or 'claude-code-sdk': the subprocess runs iff the binary exists.
  return sdkBinaryProbe();
}

/**
 * True when a single DB provider has credentials CodePilot can dispatch on.
 *
 * Checks (in order):
 *   1. api_key non-empty
 *   2. Bedrock / Vertex routing flag in env_overrides_json OR legacy extra_env
 *
 * Mirrors the resolver's `env_overrides_json || extra_env` precedence
 * (see `provider-resolver.ts:703`) so we never say "no provider configured"
 * while the resolver would actually accept the same record.
 */
export function providerHasUsableCodePilotAuth(p: ApiProvider): boolean {
  if (p.api_key) return true;

  const raw = p.env_overrides_json || p.extra_env || '';
  if (!raw) return false;

  // Legacy `extra_env` was historically a raw JSON blob as well, so the same
  // parse handles both columns. Fall back to substring match only when JSON
  // parsing fails, preserving backwards compat with any malformed records.
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      const bedrock = parsed.CLAUDE_CODE_USE_BEDROCK;
      const vertex = parsed.CLAUDE_CODE_USE_VERTEX;
      if (bedrock != null && bedrock !== '' && bedrock !== '0' && bedrock !== false) return true;
      if (vertex != null && vertex !== '' && vertex !== '0' && vertex !== false) return true;
    }
  } catch {
    // Legacy plaintext — fall through to substring match
    if (raw.includes('CLAUDE_CODE_USE_BEDROCK')) return true;
    if (raw.includes('CLAUDE_CODE_USE_VERTEX')) return true;
  }

  return false;
}

/**
 * True when CodePilot has at least one provider the backend can dispatch to.
 *
 * fail-open on DB errors: if a read throws (e.g. not initialized yet in a
 * cold worker), we return `true` and let the downstream resolver produce the
 * real error. Rationale: blocking the user on a transient DB glitch is worse
 * than letting the request surface an accurate upstream error.
 */
export function hasCodePilotProvider(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return true;
  }

  try {
    if (getSetting('anthropic_auth_token')) return true;
  } catch {
    // getSetting failing is severe enough to fail-open
    return true;
  }

  // OpenAI OAuth is a virtual provider (no DB record) that the resolver
  // recognises under providerId='openai-oauth'. isOAuthUsable() is the
  // synchronous precheck shared with native-runtime's own auth path.
  try {
    if (isOAuthUsable()) return true;
  } catch {
    return true;
  }

  try {
    if (isXaiOAuthUsable()) return true;
  } catch {
    return true;
  }

  try {
    for (const p of getAllProviders()) {
      if (providerHasUsableCodePilotAuth(p)) return true;
    }
  } catch {
    return true;
  }

  // Claude Code CLI login — last because the binary probe may spawn a
  // subprocess. When the SDK runtime will serve this send, the `claude`
  // subprocess reuses whatever the CLI is authenticated with; we defer auth to
  // it rather than (unreliably) detecting login state here. See the file
  // header for the full rationale. Gated on runtime because Native / Codex
  // can't use the CLI login — they need their own key / account.
  try {
    if (claudeCodeSdkWillRun()) return true;
  } catch {
    // Probe failure (e.g. binary --version timed out) is fail-open, consistent
    // with the DB/OAuth probes above: let the downstream resolver surface the
    // real error instead of blocking on a transient glitch.
    return true;
  }

  return false;
}
