import { autoUpdater } from 'electron-updater';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';

let mainWindow: BrowserWindow | null = null;

function sendStatus(data: Record<string, unknown>) {
  mainWindow?.webContents.send('updater:status', data);
}

export function initAutoUpdater(win: BrowserWindow) {
  mainWindow = win;

  // Configuration
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // --- Events ---
  autoUpdater.on('checking-for-update', () => {
    sendStatus({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus({
      status: 'available',
      info: {
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseName: info.releaseName,
        releaseDate: info.releaseDate,
      },
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendStatus({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({
      status: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({
      status: 'downloaded',
      info: {
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseName: info.releaseName,
        releaseDate: info.releaseDate,
      },
    });
  });

  autoUpdater.on('error', (err) => {
    sendStatus({ status: 'error', error: err.message });
  });

  // --- IPC handlers ---
  ipcMain.handle('updater:check', async () => {
    return autoUpdater.checkForUpdates();
  });

  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall();
  });

  // Initial check after 10 seconds
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] Initial check failed:', err.message);
    });
  }, 10_000);

  // Periodic check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] Periodic check failed:', err.message);
    });
  }, 4 * 60 * 60 * 1000);
}

export function setUpdaterWindow(win: BrowserWindow) {
  mainWindow = win;
}
