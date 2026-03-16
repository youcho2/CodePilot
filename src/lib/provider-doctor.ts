/**
 * Provider Doctor — diagnostic engine for provider/CLI/auth health checks.
 *
 * Runs a series of probes and produces a structured diagnosis with
 * findings, severity levels, and suggested repair actions.
 */

import {
  findClaudeBinary,
  getClaudeVersion,
  findAllClaudeBinaries,
  isWindows,
  findGitBash,
} from '@/lib/platform';
import { resolveProvider } from '@/lib/provider-resolver';
import {
  getAllProviders,
  getDefaultProviderId,
  getProvider,
  getSetting,
} from '@/lib/db';

// ── Types ───────────────────────────────────────────────────────

export type Severity = 'ok' | 'warn' | 'error';

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
  detail?: string;
  /** Repair actions applicable to this specific finding (populated after diagnosis) */
  repairActions?: Array<{ id: string; label: string; description: string; params?: Record<string, string> }>;
}

export interface ProbeResult {
  probe: string;
  severity: Severity;
  findings: Finding[];
  durationMs: number;
}

export type RepairActionType =
  | 'set-default-provider'
  | 'apply-provider-to-session'
  | 'clear-stale-resume'
  | 'switch-auth-style'
  | 'reimport-env-config';

export interface RepairAction {
  type: RepairActionType;
  label: string;
  description: string;
  /** Which finding codes this action addresses */
  addresses: string[];
}

export interface DiagnosisResult {
  overallSeverity: Severity;
  probes: ProbeResult[];
  repairs: RepairAction[];
  timestamp: string;
  durationMs: number;
}

// ── Helpers ─────────────────────────────────────────────────────

function maskKey(key: string | undefined | null): { exists: boolean; last4?: string } {
  if (!key) return { exists: false };
  return { exists: true, last4: key.slice(-4) };
}

function maxSeverity(a: Severity, b: Severity): Severity {
  const rank: Record<Severity, number> = { ok: 0, warn: 1, error: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function probeSeverity(findings: Finding[]): Severity {
  let sev: Severity = 'ok';
  for (const f of findings) sev = maxSeverity(sev, f.severity);
  return sev;
}

// ── CLI Probe ───────────────────────────────────────────────────

async function runCliProbe(): Promise<ProbeResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  // Check primary binary
  const bin = findClaudeBinary();
  if (!bin) {
    findings.push({
      severity: 'error',
      code: 'cli.not-found',
      message: 'Claude CLI binary not found on this system',
      detail: 'Install Claude Code CLI: npm install -g @anthropic-ai/claude-code',
    });
  } else {
    const version = await getClaudeVersion(bin);
    if (version) {
      findings.push({
        severity: 'ok',
        code: 'cli.found',
        message: `Claude CLI found at ${bin}`,
        detail: `Version: ${version}`,
      });
    } else {
      findings.push({
        severity: 'warn',
        code: 'cli.version-failed',
        message: `Claude CLI found at ${bin} but --version failed`,
        detail: 'The binary may be corrupted or incompatible',
      });
    }
  }

  // Check for multiple installations
  const allBinaries = findAllClaudeBinaries();
  if (allBinaries.length > 1) {
    const paths = allBinaries.map(b => `${b.path} (${b.version || 'unknown'})`).join(', ');
    findings.push({
      severity: 'warn',
      code: 'cli.multiple-installs',
      message: `Multiple Claude CLI installations detected (${allBinaries.length})`,
      detail: paths,
    });
  }

  // Windows-specific: check Git Bash
  if (isWindows) {
    const gitBash = findGitBash();
    if (gitBash) {
      findings.push({
        severity: 'ok',
        code: 'cli.git-bash',
        message: `Git Bash found at ${gitBash}`,
      });
    } else {
      findings.push({
        severity: 'warn',
        code: 'cli.git-bash-missing',
        message: 'Git Bash not found (recommended for Claude CLI on Windows)',
      });
    }
  }

  return {
    probe: 'cli',
    severity: probeSeverity(findings),
    findings,
    durationMs: Date.now() - start,
  };
}

// ── Auth Probe ──────────────────────────────────────────────────

async function runAuthProbe(): Promise<ProbeResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  // Check environment auth
  const envApiKey = process.env.ANTHROPIC_API_KEY;
  const envAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const dbAuthToken = getSetting('anthropic_auth_token');

  if (envApiKey) {
    findings.push({
      severity: 'ok',
      code: 'auth.env-api-key',
      message: 'ANTHROPIC_API_KEY set in environment',
      detail: JSON.stringify(maskKey(envApiKey)),
    });
  }
  if (envAuthToken) {
    findings.push({
      severity: 'ok',
      code: 'auth.env-auth-token',
      message: 'ANTHROPIC_AUTH_TOKEN set in environment',
      detail: JSON.stringify(maskKey(envAuthToken)),
    });
  }
  if (dbAuthToken) {
    findings.push({
      severity: 'ok',
      code: 'auth.db-auth-token',
      message: 'Auth token stored in DB settings',
      detail: JSON.stringify(maskKey(dbAuthToken)),
    });
  }

  // Warn if both API_KEY and AUTH_TOKEN are set — ambiguous auth style
  if (envApiKey && envAuthToken) {
    findings.push({
      severity: 'warn',
      code: 'auth.both-styles-set',
      message: 'Both ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are set in environment — auth style is ambiguous',
      detail: 'Remove one of them from your shell profile or .env file to avoid auth header conflicts. AUTH_TOKEN uses Bearer, API_KEY uses x-api-key.',
    });
  }

  if (!envApiKey && !envAuthToken && !dbAuthToken) {
    // Check if there are any configured providers with keys
    const providers = getAllProviders();
    const withKeys = providers.filter(p => !!p.api_key);
    if (withKeys.length === 0) {
      findings.push({
        severity: 'error',
        code: 'auth.no-credentials',
        message: 'No API credentials found (environment, DB settings, or providers)',
      });
    } else {
      findings.push({
        severity: 'ok',
        code: 'auth.provider-keys-only',
        message: `No environment credentials, but ${withKeys.length} provider(s) have API keys configured`,
      });
    }
  }

  // Check resolved provider auth
  try {
    const resolved = resolveProvider();
    if (resolved.hasCredentials) {
      findings.push({
        severity: 'ok',
        code: 'auth.resolved-ok',
        message: `Resolved provider has usable credentials (authStyle: ${resolved.authStyle})`,
      });
    } else {
      findings.push({
        severity: 'warn',
        code: 'auth.resolved-no-creds',
        message: 'Resolved provider reports no usable credentials',
        detail: resolved.provider
          ? `Provider "${resolved.provider.name}" (${resolved.protocol})`
          : 'Environment mode',
      });
    }
    // Check for provider-level auth style conflict
    if (resolved.provider) {
      try {
        const pEnv = JSON.parse(resolved.provider.extra_env || '{}');
        if ('ANTHROPIC_API_KEY' in pEnv && 'ANTHROPIC_AUTH_TOKEN' in pEnv) {
          findings.push({
            severity: 'warn',
            code: 'auth.style-mismatch',
            message: `Provider "${resolved.provider.name}" has both ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN in extra_env — auth style is ambiguous`,
          });
        }
      } catch { /* ignore parse errors */ }
    }
  } catch (err) {
    findings.push({
      severity: 'error',
      code: 'auth.resolve-failed',
      message: 'Failed to resolve provider for auth check',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    probe: 'auth',
    severity: probeSeverity(findings),
    findings,
    durationMs: Date.now() - start,
  };
}

// ── Provider Probe ──────────────────────────────────────────────

async function runProviderProbe(): Promise<ProbeResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  const providers = getAllProviders();
  const defaultId = getDefaultProviderId();

  findings.push({
    severity: 'ok',
    code: 'provider.count',
    message: `${providers.length} provider(s) configured`,
  });

  if (defaultId) {
    const defaultProvider = getProvider(defaultId);
    if (defaultProvider) {
      findings.push({
        severity: 'ok',
        code: 'provider.default-set',
        message: `Default provider: "${defaultProvider.name}" (${defaultProvider.protocol || defaultProvider.provider_type})`,
      });

      // Check if default provider has a key
      if (!defaultProvider.api_key) {
        findings.push({
          severity: 'warn',
          code: 'provider.default-no-key',
          message: `Default provider "${defaultProvider.name}" has no API key`,
          detail: JSON.stringify(maskKey(defaultProvider.api_key)),
        });
      }
    } else {
      findings.push({
        severity: 'error',
        code: 'provider.default-missing',
        message: `Default provider ID "${defaultId}" not found in database`,
      });
    }
  } else if (providers.length > 0) {
    findings.push({
      severity: 'warn',
      code: 'provider.no-default',
      message: 'Providers exist but no default is set',
    });
  }

  // Check each provider for common issues
  for (const p of providers) {
    if (!p.base_url && p.protocol && !['anthropic'].includes(p.protocol)) {
      findings.push({
        severity: 'warn',
        code: 'provider.missing-base-url',
        message: `Provider "${p.name}" (${p.protocol}) has no base_url`,
        detail: `Provider ID: ${p.id}`,
      });
    }
  }

  // Check resolve path
  try {
    const resolved = resolveProvider();
    const label = resolved.provider
      ? `"${resolved.provider.name}" (${resolved.protocol})`
      : 'environment variables';
    findings.push({
      severity: 'ok',
      code: 'provider.resolve-ok',
      message: `Provider resolution path: ${label}`,
      detail: resolved.model ? `Model: ${resolved.model}` : 'No model selected',
    });
  } catch (err) {
    findings.push({
      severity: 'error',
      code: 'provider.resolve-failed',
      message: 'Provider resolution failed',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    probe: 'provider',
    severity: probeSeverity(findings),
    findings,
    durationMs: Date.now() - start,
  };
}

// ── Features Probe ──────────────────────────────────────────────

async function runFeaturesProbe(): Promise<ProbeResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  try {
    const resolved = resolveProvider();
    const protocol = resolved.protocol;

    // Thinking support — only Anthropic native API supports extended thinking
    const thinkingMode = getSetting('thinking_mode');
    if (thinkingMode && thinkingMode !== 'disabled') {
      const supportsThinking = protocol === 'anthropic';
      if (!supportsThinking) {
        findings.push({
          severity: 'warn',
          code: 'features.thinking-unsupported',
          message: `Thinking mode "${thinkingMode}" is enabled but protocol "${protocol}" may not support it`,
          detail: 'Extended thinking is only supported on the Anthropic native API',
        });
      } else {
        findings.push({
          severity: 'ok',
          code: 'features.thinking-ok',
          message: `Thinking mode "${thinkingMode}" is compatible with protocol "${protocol}"`,
        });
      }
    }

    // Context 1M — check if enabled on unsupported providers
    const context1m = getSetting('context_1m');
    if (context1m === 'true') {
      const supportsContext1m = protocol === 'anthropic';
      if (!supportsContext1m) {
        findings.push({
          severity: 'warn',
          code: 'features.context1m-unsupported',
          message: `1M context is enabled but protocol "${protocol}" may not support it`,
          detail: '1M context window is only available on Anthropic native API with supported models',
        });
      } else {
        findings.push({
          severity: 'ok',
          code: 'features.context1m-ok',
          message: '1M context is enabled and compatible with current provider',
        });
      }
    }
  } catch (err) {
    findings.push({
      severity: 'error',
      code: 'features.check-failed',
      message: 'Failed to check feature compatibility',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Check for stale sdk_session_id in recent chat sessions
  // sdk_session_id is stored per-session in chat_sessions table, not in settings
  try {
    const { getDb } = await import('@/lib/db');
    const db = getDb();
    const staleSessions = db.prepare(
      `SELECT id, sdk_session_id FROM chat_sessions
       WHERE sdk_session_id != '' AND sdk_session_id IS NOT NULL
       ORDER BY updated_at DESC LIMIT 5`
    ).all() as Array<{ id: string; sdk_session_id: string }>;

    if (staleSessions.length > 0) {
      findings.push({
        severity: 'warn',
        code: 'features.stale-session-id',
        message: `${staleSessions.length} session(s) have stored sdk_session_id — may cause resume issues if stale`,
        detail: `Session: ${staleSessions[0].id.slice(0, 12)}..., sdk_session_id: ${staleSessions[0].sdk_session_id.slice(0, 8)}...`,
      });
    }
  } catch {
    // chat_sessions table might not have the column in very old DBs
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'ok',
      code: 'features.all-ok',
      message: 'No feature compatibility issues detected',
    });
  }

  return {
    probe: 'features',
    severity: probeSeverity(findings),
    findings,
    durationMs: Date.now() - start,
  };
}

// ── Network Probe ───────────────────────────────────────────────

async function runNetworkProbe(): Promise<ProbeResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  // Collect unique base URLs to check
  const urlsToCheck = new Map<string, string>(); // url -> label

  // Default Anthropic API
  urlsToCheck.set('https://api.anthropic.com', 'Anthropic API');

  // Provider-specific URLs
  const providers = getAllProviders();
  for (const p of providers) {
    if (p.base_url) {
      try {
        const u = new URL(p.base_url);
        urlsToCheck.set(u.origin, `Provider "${p.name}"`);
      } catch {
        findings.push({
          severity: 'warn',
          code: 'network.invalid-url',
          message: `Provider "${p.name}" has invalid base_url`,
          detail: p.base_url,
        });
      }
    }
  }

  // HEAD request each URL (no API key sent)
  const TIMEOUT = 5000;
  const checks = Array.from(urlsToCheck.entries()).map(async ([url, label]) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);
      const resp = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'User-Agent': 'CodePilot-ProviderDoctor/1.0' },
      });
      clearTimeout(timer);

      findings.push({
        severity: 'ok',
        code: 'network.reachable',
        message: `${label} (${url}) is reachable`,
        detail: `Status: ${resp.status}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes('abort');
      findings.push({
        severity: 'warn',
        code: isTimeout ? 'network.timeout' : 'network.unreachable',
        message: `${label} (${url}) ${isTimeout ? 'timed out' : 'is unreachable'}`,
        detail: message,
      });
    }
  });

  await Promise.allSettled(checks);

  return {
    probe: 'network',
    severity: probeSeverity(findings),
    findings,
    durationMs: Date.now() - start,
  };
}

// ── Repair Actions ──────────────────────────────────────────────

const REPAIR_ACTIONS: RepairAction[] = [
  {
    type: 'set-default-provider',
    label: 'Set default provider',
    description: 'Configure a default provider so sessions have a clear auth path',
    addresses: ['provider.no-default', 'auth.no-credentials'],
  },
  {
    type: 'apply-provider-to-session',
    label: 'Apply provider to session',
    description: 'Assign the default provider to the current session to fix missing credentials',
    addresses: ['auth.resolved-no-creds'],
  },
  {
    type: 'clear-stale-resume',
    label: 'Clear stale session ID',
    description: 'Remove the stored sdk_session_id to prevent stale resume attempts',
    addresses: ['features.stale-session-id'],
  },
  {
    type: 'switch-auth-style',
    label: 'Switch auth style',
    description: 'Toggle between api_key and auth_token authentication for the current provider',
    // Only for provider-level conflicts (extra_env has both keys).
    // auth.both-styles-set is an env-var conflict — can't fix by editing a provider.
    addresses: ['auth.style-mismatch'],
  },
  {
    type: 'reimport-env-config',
    label: 'Re-import environment config',
    description: 'Re-read API keys and settings from environment variables into the database',
    addresses: ['auth.no-credentials', 'auth.env-api-key', 'auth.env-auth-token'],
  },
];

function computeRepairs(probes: ProbeResult[]): RepairAction[] {
  const allCodes = new Set<string>();
  for (const probe of probes) {
    for (const f of probe.findings) {
      if (f.severity !== 'ok') allCodes.add(f.code);
    }
  }

  return REPAIR_ACTIONS.filter(action =>
    action.addresses.some(code => allCodes.has(code)),
  );
}

/**
 * Attach applicable repair actions to individual findings so the frontend
 * can render "Fix" buttons directly alongside each finding.
 */
function attachRepairsToFindings(probes: ProbeResult[]): void {
  // Gather context needed to populate repair params
  const defaultProviderId = getDefaultProviderId();
  const providers = getAllProviders();
  const firstProvider = providers[0];

  for (const probe of probes) {
    for (const finding of probe.findings) {
      if (finding.severity === 'ok') continue;

      const applicable: Finding['repairActions'] = [];

      for (const action of REPAIR_ACTIONS) {
        if (!action.addresses.includes(finding.code)) continue;

        const params: Record<string, string> = {};

        switch (action.type) {
          case 'set-default-provider':
            if (firstProvider) params.providerId = firstProvider.id;
            else continue; // no provider to set
            break;
          case 'clear-stale-resume':
            // Don't try to extract truncated session IDs from detail text —
            // use the parameterless "clear all stale sessions" mode instead.
            // The repair route handles both single-session and bulk-clear.
            break;
          case 'switch-auth-style': {
            const targetPid = defaultProviderId || firstProvider?.id;
            if (!targetPid) continue;
            params.providerId = targetPid;
            // Detect current auth style from the provider's extra_env and suggest the opposite
            const targetProvider = getProvider(targetPid);
            if (targetProvider) {
              try {
                const env = JSON.parse(targetProvider.extra_env || '{}');
                const currentlyUsingToken = 'ANTHROPIC_AUTH_TOKEN' in env;
                params.authStyle = currentlyUsingToken ? 'api-key' : 'auth-token';
              } catch {
                params.authStyle = 'auth-token'; // safe default
              }
            }
            break;
          }
          case 'apply-provider-to-session':
            if (defaultProviderId) params.providerId = defaultProviderId;
            else continue;
            break;
          case 'reimport-env-config':
            // No params needed
            break;
        }

        applicable.push({
          id: action.type,
          label: action.label,
          description: action.description,
          params: Object.keys(params).length > 0 ? params : undefined,
        });
      }

      if (applicable.length > 0) {
        finding.repairActions = applicable;
      }
    }
  }
}

// ── Main Diagnosis ──────────────────────────────────────────────

/**
 * Run all diagnostic probes and return a unified diagnosis.
 */
export async function runDiagnosis(): Promise<DiagnosisResult> {
  const start = Date.now();

  const probes = await Promise.all([
    runCliProbe(),
    runAuthProbe(),
    runProviderProbe(),
    runFeaturesProbe(),
    runNetworkProbe(),
  ]);

  let overallSeverity: Severity = 'ok';
  for (const p of probes) {
    overallSeverity = maxSeverity(overallSeverity, p.severity);
  }

  const repairs = computeRepairs(probes);

  // Attach repair actions to individual findings for frontend rendering
  attachRepairsToFindings(probes);

  return {
    overallSeverity,
    probes,
    repairs,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}
