/**
 * Codex app-server process manager.
 *
 * Phase 5 Phase 1 (2026-05-13). Handles:
 *   - binary discovery (`codex` on PATH; future custom-path setting)
 *   - spawn lifecycle (`codex app-server --listen stdio://`)
 *   - JSON-RPC client wiring over the child's stdio
 *   - graceful close (avoid orphan processes per plan §硬约束)
 *
 * Singleton-per-process. Renderer / dev-server / Electron main all
 * import the same module and share the cached app-server instance —
 * concurrent `getAppServer()` calls deduplicate via an in-flight
 * promise so we don't double-spawn.
 *
 * IMPORTANT: this module is node-only (child_process / fs). Don't
 * import from client components; the `/api/codex/*` routes are the
 * client's access path.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CodexAppServerClient, type CodexTransport } from './app-server-client';
import type { CodexAvailability } from './types';

interface SpawnedTransport extends CodexTransport {
  readonly proc: ChildProcessWithoutNullStreams;
}

/**
 * Wrap a spawned child process in the CodexTransport interface.
 * Buffers partial stdout lines until newline.
 */
function makeStdioTransport(proc: ChildProcessWithoutNullStreams): SpawnedTransport {
  let buffer = '';
  let messageHandler: ((line: string) => void) | null = null;

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let newlineIdx = buffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      const trimmed = line.trim();
      if (trimmed && messageHandler) {
        messageHandler(trimmed);
      }
      newlineIdx = buffer.indexOf('\n');
    }
  });

  // Stderr is for diagnostics; tee to console at debug level so
  // tracing logs from `RUST_LOG` flow through to the operator.
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) console.debug('[codex.app-server]', line);
    }
  });

  return {
    proc,
    async send(message: string): Promise<void> {
      if (!proc.stdin.writable) {
        throw new Error('Codex app-server stdin closed');
      }
      const ok = proc.stdin.write(message + '\n', 'utf8');
      if (!ok) {
        await new Promise<void>((resolve) => proc.stdin.once('drain', resolve));
      }
    },
    onMessage(handler) {
      messageHandler = handler;
      return () => {
        if (messageHandler === handler) messageHandler = null;
      };
    },
    async close() {
      messageHandler = null;
      if (!proc.killed) {
        // Gentle shutdown first — close stdin so app-server exits its
        // request loop. Force-kill after 2s if it hasn't exited.
        try { proc.stdin.end(); } catch { /* ignore */ }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            try { proc.kill('SIGTERM'); } catch { /* ignore */ }
            resolve();
          }, 2000);
          proc.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
  };
}

/**
 * Locate the `codex` binary. Returns null when not found.
 *
 * Strategy:
 *   1. CODEX_DISABLED=1 hard-disables Codex (set in test harness so
 *      unit tests never spawn the subprocess or hit network).
 *   2. CODEX_BIN env var (test / CI override of the resolved path).
 *   3. PATH walk for `codex` (with platform-appropriate extensions).
 *      Defers to OS resolution at spawn time on win32 fallthroughs.
 *   4. macOS bundled-app fallback — `/Applications/Codex.app/Contents
 *      /Resources/codex`. The macOS Codex.app installer puts the
 *      `codex` binary inside the app bundle but doesn't always wire
 *      a PATH entry; users who installed via the .dmg see "未安装"
 *      on the Settings status page without this fallback. Phase 5b
 *      smoke round 6 (2026-05-18, user-driven).
 *
 * For the bundled-binary case (Electron packaged app) the path will
 * be resolved by a future settings hook that points here.
 */
export function findCodexBinary(): string | null {
  // Phase 5b (2026-05-15) — hard disable for tests. The wider Codex
  // surface (account, models, runtime) all funnel through this lookup,
  // so a single guard here keeps unit tests off the subprocess and off
  // the ChatGPT plugin-sync network call. CI sets it implicitly via
  // `npm run test:unit`; an interactive developer running tests
  // through their IDE picks it up the same way.
  if (process.env.CODEX_DISABLED === '1') return null;
  const fromEnv = process.env.CODEX_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  // Walk PATH and probe candidates. We don't shell out to `which`
  // because that adds a spawn cost per call.
  const path = process.env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of path.split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, 'codex' + ext);
      if (existsSync(candidate)) return candidate;
    }
  }

  // Phase 5b smoke round 6 (2026-05-18) — last-resort macOS Codex.app
  // bundled-binary fallback. The .dmg installer drops the binary
  // inside the app bundle but doesn't wire a PATH entry for it; before
  // this fallback, a user who installed Codex.app saw "未安装" on
  // Settings → 执行引擎 → Codex even though `command -v codex` would
  // resolve via the shell's macOS-specific shim. CODEX_DISABLED and
  // CODEX_BIN keep their priority above this fallback (they ran
  // first and either returned null or a resolved path). PATH wins
  // over the fallback so power users with a custom `codex` build on
  // their PATH still get it.
  if (process.platform === 'darwin') {
    const macOSBundlePath = '/Applications/Codex.app/Contents/Resources/codex';
    if (existsSync(macOSBundlePath)) return macOSBundlePath;
  }

  return null;
}

interface ManagedAppServer {
  readonly client: CodexAppServerClient;
  readonly transport: SpawnedTransport;
  readonly availability: CodexAvailability;
}

let cached: Promise<ManagedAppServer> | null = null;
let lastAvailability: CodexAvailability = { kind: 'unknown' };

/**
 * Resolve (or create) the shared app-server connection.
 *
 * Returns the managed instance OR throws when the binary isn't
 * available. Callers should check `getCodexAvailability()` first when
 * they want a non-throwing path.
 */
export async function getCodexAppServer(): Promise<ManagedAppServer> {
  if (cached) return cached;

  const binary = findCodexBinary();
  if (!binary) {
    lastAvailability = { kind: 'not_installed' };
    throw new Error('Codex binary not found on PATH (set CODEX_BIN to override)');
  }

  cached = (async (): Promise<ManagedAppServer> => {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(binary, ['app-server', '--listen', 'stdio://'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Surface tracing logs at info level by default; operator
          // can override with RUST_LOG in their environment.
          RUST_LOG: process.env.RUST_LOG ?? 'info',
        },
      });
    } catch (err) {
      cached = null;
      const reason = err instanceof Error ? err.message : String(err);
      lastAvailability = { kind: 'spawn_failed', reason };
      throw new Error(`Codex app-server spawn failed: ${reason}`);
    }

    const transport = makeStdioTransport(proc);
    const version = await readCodePilotVersion();
    const client = new CodexAppServerClient(transport, {
      version,
      title: 'CodePilot',
    });

    // Listen for unexpected exit so the cache stays accurate.
    proc.once('exit', (code, signal) => {
      console.warn('[codex.app-server] exited', { code, signal });
      if (cached) {
        // Invalidate the cache so the next caller respawns.
        cached = null;
      }
      lastAvailability = {
        kind: 'spawn_failed',
        reason: `exited with code=${code} signal=${signal}`,
      };
    });

    try {
      const init = await client.initialize();
      lastAvailability = {
        kind: 'ready',
        version: init.userAgent,
        codexHome: init.codexHome,
      };
      return { client, transport, availability: lastAvailability };
    } catch (err) {
      cached = null;
      await transport.close().catch(() => undefined);
      const reason = err instanceof Error ? err.message : String(err);
      lastAvailability = { kind: 'spawn_failed', reason };
      throw new Error(`Codex app-server initialize failed: ${reason}`);
    }
  })();

  return cached;
}

/**
 * Non-throwing availability query for Settings status card.
 * Doesn't spawn — just inspects the binary and the cached state.
 */
export async function getCodexAvailability(): Promise<CodexAvailability> {
  if (lastAvailability.kind === 'ready') return lastAvailability;
  const binary = findCodexBinary();
  if (!binary) return { kind: 'not_installed' };
  if (lastAvailability.kind === 'unknown') return { kind: 'installed_idle', binary };
  return lastAvailability;
}

/**
 * Tear down the cached app-server. Used on app exit (Electron main
 * 'before-quit' / dev-server SIGTERM) so we don't leave orphan
 * processes per plan §硬约束.
 */
export async function disposeCodexAppServer(): Promise<void> {
  const current = cached;
  if (!current) return;
  cached = null;
  try {
    const { client } = await current;
    await client.dispose();
  } catch {
    // If init failed and cached resolved with an error, the dispose
    // path may itself throw — ignore, the goal is just to free.
  }
  lastAvailability = { kind: 'unknown' };
}

/**
 * Read CodePilot's package.json version. Async wrapper around the
 * filesystem read so it's testable / can be mocked.
 */
async function readCodePilotVersion(): Promise<string> {
  // Walk up from this module until we find a package.json with name
  // "codepilot". Falls back to '0.0.0' if the lookup fails.
  let dir = __dirname;
  for (let depth = 0; depth < 10; depth++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const fs = await import('node:fs/promises');
        const pkg = JSON.parse(await fs.readFile(candidate, 'utf8'));
        if (pkg?.name === 'codepilot' && typeof pkg.version === 'string') {
          return pkg.version;
        }
      } catch {
        // ignore, keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

// Test-only: reset module state. Not exported via the package index.
export function __resetForTest(): void {
  cached = null;
  lastAvailability = { kind: 'unknown' };
}
