// =============================================================================
// Fork update assist (Path B — semi-automatic, no notarization)
//
// The fork ships macOS arm64 builds that are ad-hoc signed, NOT notarized, so
// Squirrel.Mac silent auto-update is not possible. Instead of only opening a
// browser download link, this assists the update: download the release DMG
// in-app with progress, then open it (Finder) so the user drags CodePilot into
// /Applications. The renderer's update check (`/api/app/updates`) still decides
// WHETHER an update exists and WHICH asset URL to fetch; this only performs the
// download + reveal for that URL.
//
// See docs/exec-plans/active/fork-self-update-pipeline.md (Phase 2).
// =============================================================================

import type { BrowserWindow } from 'electron';
import { shell, app, net } from 'electron';
import { createWriteStream, promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { basename } from 'node:path';

// Legacy no-ops kept so main.ts's existing import site stays valid. Native
// (Squirrel) auto-update remains disabled — see the header note.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initAutoUpdater(_win: BrowserWindow) {
  console.log('[updater] Native auto-updater disabled; fork uses assisted download (Path B).');
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function setUpdaterWindow(_win: BrowserWindow) {
  // no-op while native updater is disabled
}

export interface AssistedUpdateResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Only GitHub-owned hosts may be fetched. Release asset URLs from the GitHub
 * API point at github.com and redirect to *.githubusercontent.com CDNs.
 */
function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'github.com' || h === 'githubusercontent.com' || h.endsWith('.githubusercontent.com');
}

function isSafeInstallerUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (!isAllowedHost(u.hostname)) return false;
    // Only ship-able installer artifacts.
    return /\.(dmg|zip)$/i.test(u.pathname);
  } catch {
    return false;
  }
}

// ── Stateful download manager (start / pause / resume / cancel) ──────────────
//
// A single active installer download at a time. Pause aborts the in-flight
// request but keeps the partial file + byte offset; resume issues a ranged
// request (`Range: bytes=<offset>-`) and appends — GitHub's CDN supports it.
// Cancel aborts and deletes the partial. Progress is throttled so a fast stream
// doesn't flood the renderer with per-chunk IPC (a cause of slow transfers).

type DownloadStatus = 'downloading' | 'paused' | 'done' | 'cancelled' | 'error';

interface DownloadState {
  url: string;
  dest: string;
  total: number | null;
  received: number;
  status: DownloadStatus;
  win: BrowserWindow | null;
  request: ReturnType<typeof net.request> | null;
  settle: ((r: AssistedUpdateResult) => void) | null;
  lastEmit: number;
}

let active: DownloadState | null = null;
const PROGRESS_MIN_INTERVAL_MS = 250;

function emitProgress(state: DownloadState, force = false): void {
  const now = Date.now();
  if (!force && now - state.lastEmit < PROGRESS_MIN_INTERVAL_MS) return;
  state.lastEmit = now;
  if (state.win && !state.win.isDestroyed()) {
    const percent = state.total ? Math.min(100, Math.round((state.received / state.total) * 100)) : 0;
    state.win.webContents.send('app-update:progress', {
      percent,
      received: state.received,
      total: state.total,
      status: state.status,
    });
  }
}

/** Open the finished installer and settle the caller's promise. */
async function finalize(state: DownloadState): Promise<void> {
  state.status = 'done';
  emitProgress(state, true);
  const openErr = await shell.openPath(state.dest);
  if (openErr) shell.showItemInFolder(state.dest);
  state.settle?.({ ok: true, path: state.dest });
  state.settle = null;
  if (active === state) active = null;
}

/** Start (or resume) the HTTP transfer for `state` from its current offset. */
function beginTransfer(state: DownloadState): void {
  const resuming = state.received > 0;
  const request = net.request({ url: state.url, redirect: 'manual' });
  state.request = request;
  request.setHeader('User-Agent', 'CodePilot-Updater');
  if (resuming) request.setHeader('Range', `bytes=${state.received}-`);

  request.on('redirect', (_s: number, _m: string, redirectUrl: string) => {
    let host = '';
    try { host = new URL(redirectUrl).hostname; } catch { /* invalid */ }
    if (!host || !isAllowedHost(host)) {
      request.abort();
      failActive(state, new Error('redirect to a disallowed host'));
      return;
    }
    request.followRedirect();
  });

  request.on('response', (response) => {
    const status = response.statusCode;
    // 200 fresh, 206 partial (resume). A 200 on resume means the server ignored
    // Range — restart from zero to avoid a corrupt appended file.
    if (status < 200 || status >= 300) {
      failActive(state, new Error(`download failed: HTTP ${status}`));
      return;
    }
    if (resuming && status === 200) {
      state.received = 0; // server ignored Range → overwrite from scratch
    }
    if (state.total === null) {
      const cl = response.headers['content-length'];
      const rawLen = Array.isArray(cl) ? cl[0] : cl;
      const len = rawLen ? Number(rawLen) : null;
      // On 206 the length is the remaining bytes; add the offset for the true total.
      state.total = len === null ? null : (status === 206 ? len + state.received : len);
    }

    const append = resuming && status === 206;
    const file = createWriteStream(state.dest, append ? { flags: 'a' } : { flags: 'w' });
    if (!append) state.received = 0;
    file.on('error', (err) => failActive(state, err));

    response.on('data', (chunk: Buffer) => {
      if (state.status !== 'downloading') return; // paused/cancelled mid-flight
      state.received += chunk.length;
      // Electron's net IncomingMessage isn't a pausable Readable, so we can't
      // apply socket backpressure; the disk keeps up with a network-bound
      // download and the write buffer stays small.
      file.write(chunk);
      emitProgress(state);
    });

    response.on('end', () => {
      file.end(() => {
        if (state.status === 'downloading') void finalize(state);
        // paused/cancelled: end fired after abort — ignore.
      });
    });
    response.on('error', (err) => {
      file.end();
      if (state.status === 'downloading') failActive(state, err);
    });
  });

  request.on('error', (err) => {
    // abort() during pause/cancel surfaces here — only a real error while
    // downloading should fail the transfer.
    if (state.status === 'downloading') failActive(state, err);
  });
  request.end();
}

function failActive(state: DownloadState, err: Error): void {
  if (state.status === 'done' || state.status === 'cancelled') return;
  state.status = 'error';
  emitProgress(state, true);
  state.settle?.({ ok: false, error: err.message });
  state.settle = null;
  if (active === state) active = null;
}

/**
 * Start an assisted installer download. Resolves when the file is downloaded
 * and opened (drag-install), or with `ok:false` on error/cancel. Stays pending
 * across pause/resume. Progress + status are pushed to the renderer as
 * `app-update:progress` events.
 */
export function downloadAndOpenInstaller(
  url: string,
  win: BrowserWindow | null,
): Promise<AssistedUpdateResult> {
  if (!isSafeInstallerUrl(url)) {
    return Promise.resolve({ ok: false, error: 'unsupported or unsafe installer URL' });
  }
  // Replace any existing download.
  if (active) { try { active.request?.abort(); } catch { /* ignore */ } active = null; }

  const dir = join(app.getPath('temp'), 'codepilot-updates');
  const name = basename(new URL(url).pathname) || `CodePilot-update-${Date.now()}.dmg`;
  const dest = join(dir, name);

  return new Promise<AssistedUpdateResult>((resolve) => {
    const state: DownloadState = {
      url, dest, total: null, received: 0, status: 'downloading',
      win, request: null, settle: resolve, lastEmit: 0,
    };
    active = state;
    fsp.mkdir(dir, { recursive: true })
      .then(() => fsp.rm(dest, { force: true })) // fresh start
      .then(() => { emitProgress(state, true); beginTransfer(state); })
      .catch((err) => failActive(state, err instanceof Error ? err : new Error(String(err))));
  });
}

/** Pause the active download: abort the request, keep the partial + offset. */
export function pauseInstallerDownload(): { ok: boolean } {
  if (!active || active.status !== 'downloading') return { ok: false };
  active.status = 'paused';
  try { active.request?.abort(); } catch { /* ignore */ }
  active.request = null;
  emitProgress(active, true);
  return { ok: true };
}

/** Resume a paused download from its byte offset via a ranged request. */
export function resumeInstallerDownload(): { ok: boolean } {
  if (!active || active.status !== 'paused') return { ok: false };
  active.status = 'downloading';
  emitProgress(active, true);
  beginTransfer(active);
  return { ok: true };
}

/** Cancel the active download: abort and delete the partial file. */
export function cancelInstallerDownload(): { ok: boolean } {
  if (!active) return { ok: false };
  const state = active;
  state.status = 'cancelled';
  try { state.request?.abort(); } catch { /* ignore */ }
  emitProgress(state, true);
  void fsp.rm(state.dest, { force: true }).catch(() => { /* ignore */ });
  state.settle?.({ ok: false, error: 'cancelled' });
  state.settle = null;
  active = null;
  return { ok: true };
}
