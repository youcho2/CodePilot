/**
 * CodePilot-owned Codex home preparation.
 *
 * Codex app-server persists rollouts below CODEX_HOME. Pointing CodePilot at
 * the user's default ~/.codex made those rollouts indistinguishable from
 * first-party Codex Desktop threads. Keep runtime state in CodePilot's data
 * root while mirroring the user-owned Harness inputs that should remain
 * portable across clients.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ISOLATION_MARKER = '.codepilot-codex-home-v1.json';
const CODEPILOT_ORIGINATOR = 'codex_codepilot';
const MAX_SESSION_META_BYTES = 256 * 1024;

const SHARED_DIRECTORIES = [
  'memories',
  'memories_extensions',
  'pets',
  'plugins',
  'prompts',
  'rules',
  'skills',
  'themes',
] as const;

const SHARED_FILES = [
  'AGENTS.md',
  'AGENTS.override.md',
  'config.toml',
] as const;

const SEEDED_CREDENTIAL_FILES = [
  'auth.json',
  '.credentials.json',
] as const;

export type CodexMirrorMode =
  | 'absent'
  | 'symlink'
  | 'hardlink'
  | 'copy'
  | 'directory_copy'
  | 'target_only'
  | 'broken_link';

export interface CodexMirrorOperations {
  readonly symlinkSync: (
    source: string,
    target: string,
    type?: 'dir' | 'file' | 'junction',
  ) => void;
  readonly linkSync: (source: string, target: string) => void;
}

const DEFAULT_MIRROR_OPERATIONS: CodexMirrorOperations = {
  symlinkSync: (source, target, type) => fs.symlinkSync(source, target, type),
  linkSync: (source, target) => fs.linkSync(source, target),
};

export interface CodexHomeIsolationOptions {
  readonly env?: CodexHomeEnvironment;
  readonly homeDir?: string;
  readonly platform?: NodeJS.Platform;
  /** Dependency injection for deterministic symlink/hardlink fallback tests. */
  readonly mirrorOperations?: CodexMirrorOperations;
}

export type CodexHomeEnvironment = Readonly<Record<string, string | undefined>>;

export interface PreparedCodexHome {
  readonly codexHome: string;
  readonly sourceCodexHome: string;
  readonly migratedRollouts: number;
  readonly skippedUnreadableRollouts: number;
  readonly initializedNow: boolean;
  readonly credentialMirrors: Readonly<Record<string, CodexMirrorMode>>;
  readonly harnessSnapshotEntries: readonly string[];
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveSourceCodexHome(
  env: CodexHomeEnvironment = process.env,
  homeDir: string = os.homedir(),
): string {
  return path.resolve(nonEmpty(env.CODEX_HOME) ?? path.join(homeDir, '.codex'));
}

export function resolveCodePilotCodexHome(
  env: CodexHomeEnvironment = process.env,
  homeDir: string = os.homedir(),
): string {
  const explicit = nonEmpty(env.CODEPILOT_CODEX_HOME);
  if (explicit) return path.resolve(explicit);
  const dataDir = nonEmpty(env.CLAUDE_GUI_DATA_DIR) ?? path.join(homeDir, '.codepilot');
  return path.resolve(dataDir, 'codex-home');
}

function pathExistsIncludingBrokenLink(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function inspectMirrorEntry(source: string, target: string): CodexMirrorMode {
  if (!pathExistsIncludingBrokenLink(target)) return 'absent';
  const targetLstat = fs.lstatSync(target);
  if (targetLstat.isSymbolicLink()) {
    if (!fs.existsSync(source) || !fs.existsSync(target)) return 'broken_link';
    const sourceRealPath = fs.realpathSync.native(source);
    const targetRealPath = fs.realpathSync.native(target);
    if (sourceRealPath !== targetRealPath) {
      throw new Error(`CodePilot Codex mirror target does not resolve to its expected source: ${path.basename(target)}`);
    }
    return 'symlink';
  }
  if (!fs.existsSync(source)) return 'target_only';
  const sourceStat = fs.statSync(source);
  const targetStat = fs.statSync(target);
  if (sourceStat.isFile() && targetStat.isFile()) {
    return sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino
      ? 'hardlink'
      : 'copy';
  }
  if (sourceStat.isDirectory() && targetStat.isDirectory()) return 'directory_copy';
  throw new Error(`CodePilot Codex mirror type mismatch: ${path.basename(target)}`);
}

function copyDirectorySnapshot(
  source: string,
  target: string,
  visitedRealPaths: Set<string> = new Set(),
): void {
  const sourceRealPath = fs.realpathSync.native(source);
  const visitKey = process.platform === 'win32'
    ? sourceRealPath.toLocaleLowerCase()
    : sourceRealPath;
  if (visitedRealPaths.has(visitKey)) {
    throw Object.assign(new Error(`Recursive link in Codex home snapshot: ${source}`), {
      code: 'ELOOP',
    });
  }

  visitedRealPaths.add(visitKey);
  try {
    const sourceStat = fs.statSync(sourceRealPath);
    fs.mkdirSync(target, { mode: sourceStat.mode & 0o777 });
    for (const entry of fs.readdirSync(sourceRealPath, { withFileTypes: true })) {
      const sourceEntry = path.join(sourceRealPath, entry.name);
      const targetEntry = path.join(target, entry.name);
      const entryStat = fs.lstatSync(sourceEntry);
      if (entryStat.isSymbolicLink()) {
        const resolved = fs.realpathSync.native(sourceEntry);
        const resolvedStat = fs.statSync(resolved);
        if (resolvedStat.isDirectory()) {
          copyDirectorySnapshot(resolved, targetEntry, visitedRealPaths);
        } else if (resolvedStat.isFile()) {
          fs.copyFileSync(resolved, targetEntry, fs.constants.COPYFILE_EXCL);
        }
      } else if (entryStat.isDirectory()) {
        copyDirectorySnapshot(sourceEntry, targetEntry, visitedRealPaths);
      } else if (entryStat.isFile()) {
        fs.copyFileSync(sourceEntry, targetEntry, fs.constants.COPYFILE_EXCL);
      }
    }
  } finally {
    visitedRealPaths.delete(visitKey);
  }
}

/**
 * Keep Harness inputs live across clients without sharing runtime state.
 * Junction/hard-link fallbacks preserve Windows compatibility where ordinary
 * symlink creation can require elevated privileges. The returned mode is part
 * of the startup diagnostic contract: snapshot fallbacks must never be silent.
 */
export function mirrorCodexHomeEntry(
  source: string,
  target: string,
  platform: NodeJS.Platform,
  operations: CodexMirrorOperations = DEFAULT_MIRROR_OPERATIONS,
): CodexMirrorMode {
  if (pathExistsIncludingBrokenLink(target)) return inspectMirrorEntry(source, target);
  if (!fs.existsSync(source)) return 'absent';
  const stat = fs.statSync(source);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    operations.symlinkSync(source, target, stat.isDirectory() && platform === 'win32' ? 'junction' : undefined);
    return inspectMirrorEntry(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(code ?? '')) throw error;
  }

  if (stat.isFile()) {
    try {
      operations.linkSync(source, target);
    } catch {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    }
    return inspectMirrorEntry(source, target);
  }

  // Junction creation normally succeeds without elevation on Windows. A
  // recursive copy is the final compatibility fallback; it is intentionally
  // used only when the live mirror is unavailable.
  // Keep the fallback bounded to the selected directory. fs.cpSync performs
  // parent-path checks that can hit EPERM in Windows sandboxes even when both
  // source and destination are accessible.
  copyDirectorySnapshot(source, target);
  return inspectMirrorEntry(source, target);
}

function readSessionMeta(filePath: string): { originator?: unknown } | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_SESSION_META_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
    if (newline < 0) return null;
    const firstLine = buffer.subarray(0, newline).toString('utf8');
    const parsed = JSON.parse(firstLine) as {
      type?: unknown;
      payload?: { originator?: unknown };
    };
    if (parsed.type !== 'session_meta' || !parsed.payload) return null;
    return parsed.payload;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function listFilesRecursively(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(entryPath);
    }
  }
  return files;
}

/** Copy only CodePilot-authored rollouts. Never import the user's complete
 * first-party Codex history into the isolated runtime home. */
function migrateCodePilotRollouts(
  sourceHome: string,
  targetHome: string,
): { migrated: number; skippedUnreadable: number } {
  const sourceSessions = path.join(sourceHome, 'sessions');
  const targetSessions = path.join(targetHome, 'sessions');
  let migrated = 0;
  let skippedUnreadable = 0;

  for (const sourceFile of listFilesRecursively(sourceSessions)) {
    const metadata = readSessionMeta(sourceFile);
    if (!metadata) {
      skippedUnreadable += 1;
      continue;
    }
    if (metadata.originator !== CODEPILOT_ORIGINATOR) continue;
    const relative = path.relative(sourceSessions, sourceFile);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const targetFile = path.join(targetSessions, relative);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true, mode: 0o700 });
    try {
      fs.copyFileSync(sourceFile, targetFile, fs.constants.COPYFILE_EXCL);
      migrated += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  return { migrated, skippedUnreadable };
}

function writeMarker(
  targetHome: string,
  state: {
    readonly migratedRollouts: number;
    readonly skippedUnreadableRollouts: number;
    readonly credentialMirrors: Readonly<Record<string, CodexMirrorMode>>;
    readonly harnessSnapshotEntries: readonly string[];
  },
): void {
  const markerPath = path.join(targetHome, ISOLATION_MARKER);
  const tempPath = `${markerPath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tempPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ version: 1, ...state }) + '\n', 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tempPath, markerPath);
  } catch (error) {
    // Two server processes may initialize the home concurrently. Every step
    // above is idempotent; if the other process won the marker race, discard
    // this process's temporary marker instead of failing app-server startup.
    if (!pathExistsIncludingBrokenLink(markerPath)) throw error;
    try { fs.unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
  }
}

/**
 * Prepare the isolated CODEX_HOME before spawning app-server.
 *
 * Credential entries are seeded only on the first successful initialization.
 * This is important: if the user logs out from CodePilot, a later restart must
 * not silently re-link the official Codex client's credentials.
 */
export function prepareCodePilotCodexHome(
  options: CodexHomeIsolationOptions = {},
): PreparedCodexHome {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const mirrorOperations = options.mirrorOperations ?? DEFAULT_MIRROR_OPERATIONS;
  const sourceCodexHome = resolveSourceCodexHome(env, homeDir);
  const codexHome = resolveCodePilotCodexHome(env, homeDir);

  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') fs.chmodSync(codexHome, 0o700);
  const canonicalSource = fs.existsSync(sourceCodexHome)
    ? fs.realpathSync.native(sourceCodexHome)
    : sourceCodexHome;
  const canonicalTarget = fs.realpathSync.native(codexHome);
  if (canonicalSource === canonicalTarget) {
    throw new Error('CodePilot Codex home must be different from the user Codex home');
  }

  // Profiles are open-ended (`<name>.config.toml`), so discover them instead
  // of freezing a list that would silently omit future user profiles.
  const sharedFiles: string[] = [...SHARED_FILES];
  if (fs.existsSync(sourceCodexHome)) {
    for (const entry of fs.readdirSync(sourceCodexHome, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.config.toml')) sharedFiles.push(entry.name);
    }
  }
  const harnessSnapshotEntries: string[] = [];
  const recordHarnessMirror = (name: string, mode: CodexMirrorMode) => {
    if (['copy', 'directory_copy', 'target_only', 'broken_link'].includes(mode)) {
      harnessSnapshotEntries.push(name);
    }
  };
  for (const name of new Set(sharedFiles)) {
    const mode = mirrorCodexHomeEntry(
      path.join(sourceCodexHome, name),
      path.join(codexHome, name),
      platform,
      mirrorOperations,
    );
    recordHarnessMirror(name, mode);
  }
  for (const name of SHARED_DIRECTORIES) {
    const mode = mirrorCodexHomeEntry(
      path.join(sourceCodexHome, name),
      path.join(codexHome, name),
      platform,
      mirrorOperations,
    );
    recordHarnessMirror(name, mode);
  }

  const markerPath = path.join(codexHome, ISOLATION_MARKER);
  const initializedBefore = pathExistsIncludingBrokenLink(markerPath);
  const credentialMirrors: Record<string, CodexMirrorMode> = {};
  for (const name of SEEDED_CREDENTIAL_FILES) {
    const source = path.join(sourceCodexHome, name);
    const target = path.join(codexHome, name);
    // Never recreate a removed credential after initialization: removal can
    // be an explicit CodePilot logout. We still inspect the live shape so a
    // symlink/hardlink that became an independent file is visible in logs.
    credentialMirrors[name] = initializedBefore
      ? inspectMirrorEntry(source, target)
      : mirrorCodexHomeEntry(source, target, platform, mirrorOperations);
  }
  if (initializedBefore) {
    return {
      codexHome,
      sourceCodexHome,
      migratedRollouts: 0,
      skippedUnreadableRollouts: 0,
      initializedNow: false,
      credentialMirrors,
      harnessSnapshotEntries,
    };
  }

  const migration = migrateCodePilotRollouts(sourceCodexHome, codexHome);
  writeMarker(codexHome, {
    migratedRollouts: migration.migrated,
    skippedUnreadableRollouts: migration.skippedUnreadable,
    credentialMirrors,
    harnessSnapshotEntries,
  });

  return {
    codexHome,
    sourceCodexHome,
    migratedRollouts: migration.migrated,
    skippedUnreadableRollouts: migration.skippedUnreadable,
    initializedNow: true,
    credentialMirrors,
    harnessSnapshotEntries,
  };
}
