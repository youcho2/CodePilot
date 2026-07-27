/**
 * proxy-config.ts — Single source of truth for the user-configured network
 * proxy (Settings → General → Network proxy).
 *
 * Why this exists (2026-07-27): corporate/internal users reach Anthropic (and
 * other providers) only through an egress proxy. Before this, CodePilot only
 * honored a proxy if it was in the login-shell env (which power users
 * deliberately keep out of their profile) or the macOS system proxy (global,
 * affects every app). A CLI login that works in the terminal via a wrapper
 * (`HTTPS_PROXY=... claude`) then failed inside CodePilot with
 * `403 Request not allowed`, because the spawned `claude` subprocess had no
 * proxy. See issue-tracker B-031.
 *
 * This module lets the user store ONE proxy in-app and applies it to every
 * outbound path:
 *   - SDK subprocess (`prepareSdkSubprocessEnv`)  — env overlay
 *   - Codex app-server subprocess                 — env overlay
 *   - Native / OAuth / model-discovery Node fetch — a global Undici
 *     `EnvHttpProxyAgent` (installed ONLY when a proxy is configured, so
 *     users without one see zero behavior change), which honors NO_PROXY so
 *     the app's own 127.0.0.1 server/SSE traffic stays direct.
 *
 * Takes effect on the NEXT send/fetch after save — no restart — because the
 * subprocess overlays read the setting at spawn time and the settings PUT
 * re-syncs process.env + refreshes the global dispatcher.
 */
import { setGlobalDispatcher, EnvHttpProxyAgent, Agent } from 'undici';
import { getSetting } from '@/lib/db';

export const PROXY_URL_SETTING = 'network_proxy_url';
export const PROXY_NO_PROXY_SETTING = 'network_no_proxy';

/**
 * Loopback hosts must NEVER route through the proxy: the packaged app's own
 * Next server + SSE stream live on 127.0.0.1, and the global dispatcher we
 * install for proxy users would otherwise send that internal traffic through
 * the corporate proxy and hang the UI. Always merged into NO_PROXY.
 */
const ALWAYS_NO_PROXY = ['localhost', '127.0.0.1', '::1'];

export interface ConfiguredProxy {
  /** Validated http(s) proxy URL, e.g. `http://10.0.0.1:3218`. */
  url: string;
  /** Comma-separated NO_PROXY list, guaranteed to include the loopback hosts. */
  noProxy: string;
}

function splitList(raw: string | undefined | null): string[] {
  return (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/** Merge the user's no-proxy list with the mandatory loopback bypass, deduped. */
export function mergeNoProxy(userNoProxy: string | undefined | null): string {
  const set = new Set<string>(ALWAYS_NO_PROXY);
  for (const entry of splitList(userNoProxy)) set.add(entry);
  return Array.from(set).join(',');
}

/**
 * Read + validate the in-app proxy setting. Returns null when unset or when
 * the stored URL isn't a usable http(s) proxy (so a malformed value can never
 * silently break every outbound request — we fall back to inherited/system
 * env instead).
 */
export function getConfiguredProxy(): ConfiguredProxy | null {
  let url: string | undefined;
  try {
    url = getSetting(PROXY_URL_SETTING)?.trim();
  } catch {
    return null;
  }
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  let noProxyRaw: string | undefined;
  try {
    noProxyRaw = getSetting(PROXY_NO_PROXY_SETTING) ?? undefined;
  } catch {
    noProxyRaw = undefined;
  }
  return { url, noProxy: mergeNoProxy(noProxyRaw) };
}

/**
 * The proxy env vars (upper + lower case, per Undici/curl precedence) for a
 * configured proxy, or null when none is configured.
 */
export function buildProxyEnvVars(
  proxy: ConfiguredProxy | null = getConfiguredProxy(),
): Record<string, string> | null {
  if (!proxy) return null;
  return {
    HTTP_PROXY: proxy.url,
    HTTPS_PROXY: proxy.url,
    http_proxy: proxy.url,
    https_proxy: proxy.url,
    NO_PROXY: proxy.noProxy,
    no_proxy: proxy.noProxy,
  };
}

/**
 * Overlay the configured proxy onto a subprocess env. No-op (returns a copy of
 * the input untouched) when no proxy is configured, so SDK/Codex spawns keep
 * whatever they inherited otherwise.
 */
export function applyConfiguredProxyEnv<T extends Record<string, string>>(env: T): T {
  const vars = buildProxyEnvVars();
  if (!vars) return env;
  return { ...env, ...vars };
}

/**
 * Write the configured proxy into this process's env so Undici's
 * EnvHttpProxyAgent + env-proxy-fetch see it. Only WRITES when a proxy is
 * configured — never deletes inherited/system proxy vars, so clearing the
 * in-app proxy reverts to whatever the shell/system provided rather than
 * forcing direct.
 */
export function syncConfiguredProxyToProcessEnv(): void {
  const vars = buildProxyEnvVars();
  if (!vars) return;
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
}

let installedByUs = false;

/**
 * Install (or tear down) a global Undici dispatcher so plain Node `fetch`
 * (native provider, OAuth token exchange, model discovery) routes through the
 * configured proxy. Gated on an in-app proxy being set, so users without one
 * keep Node's default direct dispatcher — no behavior change and no risk to
 * loopback traffic. EnvHttpProxyAgent reads process.env at construction, so
 * callers MUST run syncConfiguredProxyToProcessEnv() first.
 */
export function installOrRefreshGlobalProxyDispatcher(): void {
  const proxy = getConfiguredProxy();
  if (proxy) {
    // Guarantee loopback bypass before the agent snapshots the env.
    process.env.NO_PROXY = proxy.noProxy;
    process.env.no_proxy = proxy.noProxy;
    setGlobalDispatcher(new EnvHttpProxyAgent());
    installedByUs = true;
  } else if (installedByUs) {
    // Proxy was cleared after we installed one — restore the default direct
    // dispatcher instead of leaving stale proxy routing in place.
    setGlobalDispatcher(new Agent());
    installedByUs = false;
  }
}

/** Boot + on-save entry point: sync env then (re)install the dispatcher. */
export function initProxyFromSettings(): void {
  syncConfiguredProxyToProcessEnv();
  installOrRefreshGlobalProxyDispatcher();
}
