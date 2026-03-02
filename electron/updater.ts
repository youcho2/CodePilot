import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';

let win: BrowserWindow | null = null;

function sendStatus(data: {
  status: string;
  info?: unknown;
  progress?: unknown;
  error?: string;
}) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', data);
  }
}

export function initAutoUpdater(_win: BrowserWindow) {
  win = _win;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendStatus({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus({ status: 'available', info });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendStatus({ status: 'not-available', info });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({ status: 'downloading', progress });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ status: 'downloaded', info });
  });

  autoUpdater.on('error', (err) => {
    sendStatus({ status: 'error', error: err?.message ?? String(err) });
  });

  // IPC handlers
  ipcMain.handle('updater:check', async () => {
    return autoUpdater.checkForUpdates();
  });

  ipcMain.handle('updater:download', async () => {
    return autoUpdater.downloadUpdate();
  });

  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall();
  });

  // Delayed initial check (10 seconds after launch)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[updater] Initial update check failed:', err?.message ?? err);
    });
  }, 10_000);
}

export function setUpdaterWindow(_win: BrowserWindow) {
  win = _win;
}
