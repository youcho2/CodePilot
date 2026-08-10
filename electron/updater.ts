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

/**
 * Stream a URL to `dest` via Electron's `net` (Chromium network stack), which
 * routes through the default session's resolved proxy — the system proxy
 * (Clash / VPN / PAC). Node's `https` ignores that, so a direct GitHub
 * connection was the likely cause of very slow downloads. Follows GitHub's
 * redirects (validated against the host allowlist) and reports byte progress.
 */
function downloadWithProgress(
  url: string,
  dest: string,
  onProgress: (received: number, total: number | null) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'manual' });
    request.setHeader('User-Agent', 'CodePilot-Updater');

    request.on('redirect', (_status: number, _method: string, redirectUrl: string) => {
      let host = '';
      try { host = new URL(redirectUrl).hostname; } catch { /* invalid URL */ }
      if (!host || !isAllowedHost(host)) {
        request.abort();
        reject(new Error('redirect to a disallowed host'));
        return;
      }
      request.followRedirect();
    });

    request.on('response', (response) => {
      const status = response.statusCode;
      if (status < 200 || status >= 300) {
        reject(new Error(`download failed: HTTP ${status}`));
        return;
      }
      const cl = response.headers['content-length'];
      const rawLen = Array.isArray(cl) ? cl[0] : cl;
      const total = rawLen ? Number(rawLen) : null;
      let received = 0;
      const file = createWriteStream(dest);
      file.on('error', reject);
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        file.write(chunk);
        onProgress(received, total);
      });
      response.on('end', () => file.end(() => resolve()));
      response.on('error', reject);
    });

    request.on('error', reject);
    request.end();
  });
}

/**
 * Download the given installer URL to a temp file with progress (sent to the
 * renderer as `app-update:progress` percent), then open it so the user can drag
 * CodePilot into /Applications. Returns the downloaded path or an error string.
 */
export async function downloadAndOpenInstaller(
  url: string,
  win: BrowserWindow | null,
): Promise<AssistedUpdateResult> {
  if (!isSafeInstallerUrl(url)) {
    return { ok: false, error: 'unsupported or unsafe installer URL' };
  }
  const sendProgress = (percent: number) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('app-update:progress', { percent });
    }
  };
  try {
    const dir = join(app.getPath('temp'), 'codepilot-updates');
    await fsp.mkdir(dir, { recursive: true });
    const name = basename(new URL(url).pathname) || `CodePilot-update-${Date.now()}.dmg`;
    const dest = join(dir, name);

    sendProgress(0);
    await downloadWithProgress(url, dest, (received, total) => {
      const pct = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
      sendProgress(pct);
    });
    sendProgress(100);

    // Open the DMG/zip in Finder so the user completes the drag-install.
    const openErr = await shell.openPath(dest);
    if (openErr) {
      // Downloaded but couldn't auto-open — reveal it instead.
      shell.showItemInFolder(dest);
    }
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
