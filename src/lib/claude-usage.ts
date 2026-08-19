/**
 * Claude Code subscription usage — LIVE, on-demand.
 *
 * Unlike the transient `rate_limit_event` the Agent SDK emits mid-stream
 * (see stream-session-manager.ts → SessionStreamSnapshot.rateLimitInfo),
 * this queries the SAME endpoint the `/usage` slash command reads:
 *
 *     GET {BASE_API_URL}/api/oauth/usage
 *       Authorization: Bearer <claude.ai OAuth accessToken>
 *       anthropic-beta: oauth-2025-04-20
 *
 * The endpoint is undocumented/internal (extracted from the SDK bundle,
 * `@anthropic-ai/claude-agent-sdk` cli.js). It ONLY works for claude.ai
 * subscription (OAuth) auth — API-key / third-party sessions have no
 * accessToken and get an honest `no-oauth` result, never a fake 0.
 *
 * Response (verified against a live max-plan account, 2026-08-19) exposes
 * a normalized `limits[]` array we prefer:
 *
 *   limits: [
 *     { kind:'session',       group:'session', percent:6, severity:'normal',
 *       resets_at:'2026-08-19T08:20:00Z', scope:null,          is_active:false },
 *     { kind:'weekly_all',    group:'weekly',  percent:8, ..., scope:null },
 *     { kind:'weekly_scoped', group:'weekly',  percent:5, ...,
 *       scope:{ model:{ display_name:'Opus' } } },
 *   ]
 *
 * `percent` is 0–100 (NOT a 0..1 fraction — the top-level `five_hour`/
 * `seven_day.utilization` fields are also 0–100 here). `resets_at` is an
 * ISO-8601 string (NOT epoch seconds). Upstream reports no absolute token
 * counts, so "remaining" must render as `100 − percent`%, never tokens.
 */

import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';
// Mirror the CLI's User-Agent — the endpoint is CLI-oriented and may gate
// on UA. Kept generic; not a version we need to keep in lockstep.
const USER_AGENT = 'claude-cli/2.0.0 (external, cli)';

/** One usage window, normalized from the endpoint's `limits[]`. */
export interface ClaudeUsageWindow {
  /** 'session' (5h) | 'weekly_all' | 'weekly_scoped' | other upstream kinds. */
  kind: string;
  /** 'session' | 'weekly' — coarse grouping upstream provides. */
  group?: string;
  /** 0–100 used percentage. Remaining = 100 − usedPercent. */
  usedPercent: number;
  /** ISO-8601 timestamp string when the window rolls over. */
  resetsAt?: string;
  /** Upstream severity hint: 'normal' | 'warning' | 'critical' | … */
  severity?: string;
  /** For weekly_scoped: the model the scope applies to (e.g. "Opus"). */
  scopeModel?: string;
  /** Whether this is the currently-binding window. */
  isActive?: boolean;
}

export interface ClaudeUsageSnapshot {
  windows: ClaudeUsageWindow[];
  /** Plan tier from stored creds ('max' | 'pro' | …), display-only. */
  subscriptionType?: string;
  /** Epoch ms when this snapshot was fetched. */
  capturedAt: number;
}

export type ClaudeUsageReason = 'no-oauth' | 'expired' | 'unauthorized' | 'unavailable';

export type ClaudeUsageResult =
  | { snapshot: ClaudeUsageSnapshot; reason?: undefined; error?: undefined }
  | { snapshot: null; reason: ClaudeUsageReason; error?: string };

interface StoredOAuth {
  accessToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
}

/** Resolve the Claude config dir the SDK uses (CLAUDE_CONFIG_DIR or ~/.claude). */
function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/** Read `claudeAiOauth` from the macOS keychain, if present. Never throws. */
function readOAuthFromKeychain(): StoredOAuth | null {
  if (process.platform !== 'darwin') return null;
  try {
    const raw = execFileSyncSafe('security', [
      'find-generic-password',
      '-s',
      'Claude Code-credentials',
      '-w',
    ]);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed?.claudeAiOauth as StoredOAuth) ?? null;
  } catch {
    return null;
  }
}

/** Read `claudeAiOauth` from `<configDir>/.credentials.json`, if present. */
function readOAuthFromFile(): StoredOAuth | null {
  try {
    const p = path.join(claudeConfigDir(), '.credentials.json');
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return (parsed?.claudeAiOauth as StoredOAuth) ?? null;
  } catch {
    return null;
  }
}

/** execFile → string with a hard timeout, swallowing all errors → ''. */
function execFileSyncSafe(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { timeout: 3000, encoding: 'utf-8' }).toString().trim();
  } catch {
    return '';
  }
}

function readStoredOAuth(): StoredOAuth | null {
  // Keychain first on macOS (the SDK's primary store), then the file form
  // used on Linux/Windows or when CLAUDE_CONFIG_DIR points at a file store.
  return readOAuthFromKeychain() ?? readOAuthFromFile();
}

function scopeModelName(scope: unknown): string | undefined {
  if (!scope || typeof scope !== 'object') return undefined;
  const model = (scope as { model?: { display_name?: unknown } }).model;
  const name = model?.display_name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** Narrow the raw endpoint payload to our snapshot. Prefers `limits[]`. */
export function parseClaudeUsage(
  raw: unknown,
  subscriptionType: string | undefined,
  now: number,
): ClaudeUsageSnapshot {
  const windows: ClaudeUsageWindow[] = [];
  const data = (raw ?? {}) as Record<string, unknown>;

  const limits = data.limits;
  if (Array.isArray(limits) && limits.length > 0) {
    for (const entry of limits) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const percent = typeof e.percent === 'number' ? e.percent : undefined;
      if (percent == null) continue;
      windows.push({
        kind: typeof e.kind === 'string' ? e.kind : 'unknown',
        group: typeof e.group === 'string' ? e.group : undefined,
        usedPercent: clampPercent(percent),
        resetsAt: typeof e.resets_at === 'string' ? e.resets_at : undefined,
        severity: typeof e.severity === 'string' ? e.severity : undefined,
        scopeModel: scopeModelName(e.scope),
        isActive: typeof e.is_active === 'boolean' ? e.is_active : undefined,
      });
    }
  } else {
    // Legacy fallback: top-level named windows (utilization 0–100, ISO reset).
    const legacy: Array<[string, string]> = [
      ['five_hour', 'session'],
      ['seven_day', 'weekly_all'],
      ['seven_day_sonnet', 'weekly_scoped'],
      ['seven_day_opus', 'weekly_scoped'],
    ];
    for (const [field, kind] of legacy) {
      const w = data[field];
      if (!w || typeof w !== 'object') continue;
      const util = (w as { utilization?: unknown }).utilization;
      if (typeof util !== 'number') continue;
      windows.push({
        kind,
        group: kind === 'session' ? 'session' : 'weekly',
        usedPercent: clampPercent(util),
        resetsAt:
          typeof (w as { resets_at?: unknown }).resets_at === 'string'
            ? ((w as { resets_at?: string }).resets_at as string)
            : undefined,
      });
    }
  }

  return { windows, subscriptionType, capturedAt: now };
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

interface CurlResult {
  status: number;
  body: string;
}

/**
 * GET via the system `curl`, NOT Node's fetch/https.
 *
 * Anthropic's edge TLS-fingerprint-blocks Node's HTTP client (both undici
 * `fetch` and the `https` module return 403 "Request not allowed" with
 * otherwise-identical headers); the real CLI runs under Bun, whose TLS
 * stack is allowed. Shelling to curl (present on macOS/Windows/Linux
 * desktop) is the reliable path. The token is passed via a stdin config
 * (`-K -`) so it never appears in argv / `ps`.
 */
function curlGetJson(url: string, token: string): Promise<CurlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'curl',
      ['-sS', '--max-time', '8', '-w', '\n%{http_code}', '-K', '-'],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let out = '';
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      done(() => reject(new Error('curl timeout')));
    }, 10_000);

    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', (err) => {
      clearTimeout(killTimer);
      done(() => reject(err)); // ENOENT when curl is absent
    });
    child.on('close', () => {
      clearTimeout(killTimer);
      const nl = out.lastIndexOf('\n');
      const status = Number(out.slice(nl + 1).trim());
      const body = nl >= 0 ? out.slice(0, nl) : out;
      done(() => resolve({ status: Number.isFinite(status) ? status : 0, body }));
    });

    // curl config on stdin — url + headers, keeping the bearer token off argv.
    const config = [
      `url = "${url}"`,
      `header = "Authorization: Bearer ${token}"`,
      `header = "anthropic-beta: ${OAUTH_BETA}"`,
      `header = "Content-Type: application/json"`,
      `header = "User-Agent: ${USER_AGENT}"`,
      `header = "Accept: */*"`,
      '',
    ].join('\n');
    child.stdin.on('error', () => {}); // ignore EPIPE if curl exits early
    child.stdin.write(config);
    child.stdin.end();
  });
}

/**
 * Fetch live Claude subscription usage. Non-throwing: returns a discriminated
 * result the API route/UI turns into an honest empty state.
 */
export async function readClaudeUsage(): Promise<ClaudeUsageResult> {
  const oauth = readStoredOAuth();
  if (!oauth?.accessToken) {
    return { snapshot: null, reason: 'no-oauth' };
  }

  let res: CurlResult;
  try {
    res = await curlGetJson(USAGE_ENDPOINT, oauth.accessToken);
  } catch (err) {
    return {
      snapshot: null,
      reason: 'unavailable',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (res.status === 401 || res.status === 403) {
    // Token stale/expired — the SDK refreshes on next use; we don't.
    return { snapshot: null, reason: 'expired' };
  }
  if (res.status < 200 || res.status >= 300) {
    return { snapshot: null, reason: 'unavailable', error: `HTTP ${res.status}` };
  }

  let body: unknown;
  try {
    body = JSON.parse(res.body);
  } catch (err) {
    return {
      snapshot: null,
      reason: 'unavailable',
      error: err instanceof Error ? err.message : 'parse error',
    };
  }

  const snapshot = parseClaudeUsage(body, oauth.subscriptionType, Date.now());
  if (snapshot.windows.length === 0) {
    // Reachable + authed but no windows — treat as unavailable, not fake data.
    return { snapshot: null, reason: 'unavailable', error: 'no usage windows' };
  }
  return { snapshot };
}
