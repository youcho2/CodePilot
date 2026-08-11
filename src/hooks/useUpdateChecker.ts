"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { UpdateInfo, UpdateContextValue } from "@/hooks/useUpdate";

const CHECK_INTERVAL = 8 * 60 * 60 * 1000; // 8 hours
const DISMISSED_VERSION_KEY = "codepilot_dismissed_update_version";
// Per-session dismiss: clicking "稍后" in this run shouldn't make the
// dialog re-appear on every page navigation. Stored in sessionStorage
// so a fresh tab / app restart will still nudge the user once.
const SESSION_DISMISSED_VERSION_KEY = "codepilot_session_dismissed_update_version";

function isVersionDismissed(version: string | undefined | null): boolean {
  if (!version || typeof window === "undefined") return false;
  if (localStorage.getItem(DISMISSED_VERSION_KEY) === version) return true;
  if (sessionStorage.getItem(SESSION_DISMISSED_VERSION_KEY) === version) return true;
  return false;
}

/**
 * Encapsulates all update-checking logic (native Electron updater + browser fallback).
 * Returns a memoised context value suitable for UpdateContext.Provider.
 */
export function useUpdateChecker(): UpdateContextValue {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  // Runtime detection: native updater available when running in Electron with updater bridge
  const isNativeUpdater = typeof window !== "undefined" && !!window.electronAPI?.updater;

  // --- Native updater status listener ---
  useEffect(() => {
    if (!isNativeUpdater) return;
    const cleanup = window.electronAPI!.updater!.onStatus((event) => {
      switch (event.status) {
        case 'available':
          setUpdateInfo((prev) => ({
            updateAvailable: true,
            latestVersion: event.info?.version ?? prev?.latestVersion ?? '',
            currentVersion: prev?.currentVersion ?? '',
            releaseName: event.info?.releaseName ?? prev?.releaseName ?? '',
            releaseNotes: typeof event.info?.releaseNotes === 'string' ? event.info.releaseNotes : prev?.releaseNotes ?? '',
            releaseUrl: prev?.releaseUrl ?? '',
            publishedAt: event.info?.releaseDate ?? prev?.publishedAt ?? '',
            downloadProgress: null,
            readyToInstall: false,
            isNativeUpdate: true,
            lastError: null,
          }));
          {
            const ver = event.info?.version;
            if (ver && !isVersionDismissed(ver)) {
              setShowDialog(true);
            }
          }
          break;
        case 'not-available':
          setUpdateInfo((prev) => prev ? { ...prev, updateAvailable: false, isNativeUpdate: true, lastError: null } : prev);
          break;
        case 'downloading':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            downloadProgress: event.progress?.percent ?? prev.downloadProgress,
            isNativeUpdate: true,
            lastError: null,
          } : prev);
          break;
        case 'downloaded':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            readyToInstall: true,
            downloadProgress: 100,
            isNativeUpdate: true,
            lastError: null,
          } : prev);
          break;
        case 'error':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            lastError: event.error ?? 'Unknown error',
            isNativeUpdate: true,
          } : prev);
          break;
      }
      if (event.status === 'checking') {
        setChecking(true);
      } else {
        setChecking(false);
      }
    });
    return cleanup;
  }, [isNativeUpdater]);

  // --- Assisted-download progress (Path B, Electron non-native) ---
  // The fork's `appUpdate` bridge streams the release DMG and reports percent.
  // This does NOT enable native-updater mode (isNativeUpdater stays false).
  useEffect(() => {
    if (isNativeUpdater) return;
    const appUpdate = typeof window !== "undefined" ? window.electronAPI?.appUpdate : undefined;
    if (!appUpdate) return;
    const cleanup = appUpdate.onProgress(({ percent, status }) => {
      setUpdateInfo((prev) =>
        prev
          ? {
              ...prev,
              downloadProgress: percent,
              downloadStatus: status ?? prev.downloadStatus ?? 'downloading',
              // 'done' is surfaced via readyToInstall by downloadUpdate()'s resolve.
              lastError: status === 'error' ? prev.lastError : null,
            }
          : prev,
      );
    });
    return cleanup;
  }, [isNativeUpdater]);

  // --- Browser-mode update check (fallback for non-Electron) ---
  const checkForUpdatesBrowser = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/app/updates");
      if (!res.ok) return;
      const data = await res.json();
      const info: UpdateInfo = {
        ...data,
        downloadProgress: null,
        readyToInstall: false,
        isNativeUpdate: false,
        lastError: null,
      };
      // Never clobber an in-flight or finished assisted download with a
      // re-check (user-triggered or the periodic poll) — the main-process
      // download keeps running and the UI must keep showing its progress.
      let clobbered = false;
      setUpdateInfo((prev) => {
        if (prev && (prev.downloadStatus === "downloading" || prev.downloadStatus === "paused" || prev.readyToInstall)) {
          clobbered = true;
          return prev;
        }
        return info;
      });

      if (!clobbered && info.updateAvailable && !isVersionDismissed(info.latestVersion)) {
        setShowDialog(true);
      }
    } catch {
      // silently ignore network errors
    } finally {
      setChecking(false);
    }
  }, []);

  // --- Unified check: native first, browser fallback ---
  const checkForUpdates = useCallback(async () => {
    // A download is already running or finished — surface it (reopen the
    // dialog) instead of re-checking, which would otherwise look like the
    // button does nothing.
    const st = updateInfo?.downloadStatus;
    if (st === "downloading" || st === "paused" || updateInfo?.readyToInstall) {
      setShowDialog(true);
      return;
    }
    if (isNativeUpdater) {
      try {
        await window.electronAPI!.updater!.checkForUpdates();
        return;
      } catch {
        // native check failed, fall through to browser mode
      }
    }
    await checkForUpdatesBrowser();
  }, [isNativeUpdater, checkForUpdatesBrowser, updateInfo?.downloadStatus, updateInfo?.readyToInstall]);

  // Browser mode: periodic check (non-Electron or as fallback)
  useEffect(() => {
    if (isNativeUpdater) return; // native updater handles its own initial check
    checkForUpdatesBrowser();
    const id = setInterval(checkForUpdatesBrowser, CHECK_INTERVAL);
    return () => clearInterval(id);
  }, [isNativeUpdater, checkForUpdatesBrowser]);

  const dismissUpdate = useCallback(() => {
    setShowDialog(false);
    // Mark this version as dismissed for the current session so later
    // page navigations / hot reloads / chat-page mounts don't re-trigger
    // the "有新版本可用" dialog. localStorage value (set elsewhere if
    // the user has a permanent-dismiss path in the future) takes
    // precedence; sessionStorage is the per-tab fallback.
    if (typeof window !== "undefined") {
      const ver = updateInfo?.latestVersion;
      if (ver) {
        try {
          sessionStorage.setItem(SESSION_DISMISSED_VERSION_KEY, ver);
        } catch { /* private browsing / quota — silently degrade */ }
      }
    }
  }, [updateInfo]);

  const downloadUpdate = useCallback(async () => {
    if (isNativeUpdater) {
      await window.electronAPI!.updater!.downloadUpdate();
      return;
    }
    // Path B: assisted in-app download + open (Electron); the DMG opens in
    // Finder for a drag-install. `readyToInstall` here means "installer opened".
    const appUpdate = typeof window !== "undefined" ? window.electronAPI?.appUpdate : undefined;
    const url = updateInfo?.downloadUrl;
    if (appUpdate && url) {
      setUpdateInfo((prev) => (prev ? { ...prev, downloadProgress: 0, downloadStatus: 'downloading', readyToInstall: false, lastError: null } : prev));
      try {
        const res = await appUpdate.downloadAndOpen(url);
        setUpdateInfo((prev) => {
          if (!prev) return prev;
          if (res.ok) return { ...prev, downloadProgress: 100, downloadStatus: 'done', readyToInstall: true, lastError: null };
          // User cancelled → quiet reset, not an error.
          if (res.error === 'cancelled') return { ...prev, downloadProgress: null, downloadStatus: 'cancelled', lastError: null };
          return { ...prev, downloadProgress: null, downloadStatus: 'error', lastError: res.error ?? "download failed" };
        });
      } catch (e) {
        setUpdateInfo((prev) =>
          prev ? { ...prev, downloadProgress: null, downloadStatus: 'error', lastError: e instanceof Error ? e.message : String(e) } : prev,
        );
      }
      return;
    }
    // Last resort (no Electron bridge): open the download in the browser.
    if (url) window.open(url, "_blank");
  }, [isNativeUpdater, updateInfo?.downloadUrl]);

  const pauseDownload = useCallback(() => {
    window.electronAPI?.appUpdate?.pause();
  }, []);
  const resumeDownload = useCallback(() => {
    window.electronAPI?.appUpdate?.resume();
  }, []);
  const cancelDownload = useCallback(() => {
    window.electronAPI?.appUpdate?.cancel();
  }, []);

  const quitAndInstall = useCallback(() => {
    if (isNativeUpdater) {
      window.electronAPI!.updater!.quitAndInstall();
    }
  }, [isNativeUpdater]);

  return useMemo(
    () => ({
      updateInfo,
      checking,
      checkForUpdates,
      downloadUpdate,
      pauseDownload,
      resumeDownload,
      cancelDownload,
      dismissUpdate,
      showDialog,
      setShowDialog,
      quitAndInstall,
    }),
    [updateInfo, checking, checkForUpdates, downloadUpdate, pauseDownload, resumeDownload, cancelDownload, dismissUpdate, showDialog, quitAndInstall]
  );
}
