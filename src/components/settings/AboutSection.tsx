"use client";

/**
 * Settings → About — application metadata + utility entries.
 *
 * Pulls together pieces that used to be scattered through General:
 *   - Version + check-for-updates  (was UpdateCard at top of General)
 *   - Account info                  (was Account card at bottom of General)
 *   - Chat history import           (recently moved to General; lands here)
 *   - Platform info                 (new — install channel + OS)
 *   - Diagnostic / log export       (new — entry to Setup Center diagnose flow)
 *   - Documentation / GitHub / Feedback (new — external links)
 *
 * Goal: General is now strictly "application behavior"; About is
 * "what version am I running, where do I go for help, how do I see
 * my account." The two surfaces stay clean separately.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useUpdate } from "@/hooks/useUpdate";
import { useAccountInfo } from "@/hooks/useAccountInfo";
import { Button } from "@/components/ui/button";
import {
  ArrowClockwise,
  ArrowSquareOut,
  FileArrowDown,
  Stethoscope,
  SpinnerGap,
} from "@/components/ui/icon";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { ImportSessionDialog } from "@/components/layout/ImportSessionDialog";
import type { TranslationKey } from "@/i18n";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

/**
 * Best-effort platform / channel detection. Electron sets a UA marker so
 * we can distinguish "running inside the app" from "browser-tab dev".
 * Branch and arch come from `navigator.platform` as a fallback when the
 * Electron preload doesn't expose them — good enough for the About page,
 * which only needs to label the build, not gate behavior.
 */
function detectPlatform(): { os: string; channel: string } {
  if (typeof navigator === "undefined") return { os: "Unknown", channel: "Unknown" };
  const ua = navigator.userAgent || "";
  const channel = ua.includes("Electron") ? "Electron App" : "Web";
  let os = "Unknown";
  if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Win")) os = "Windows";
  else if (ua.includes("Linux")) os = "Linux";
  return { os, channel };
}

export function AboutSection() {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";
  const {
    updateInfo,
    checking,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    setShowDialog,
  } = useUpdate();
  const { accountInfo } = useAccountInfo();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [platform, setPlatform] = useState<{ os: string; channel: string }>({
    os: "—",
    channel: "—",
  });
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const isDownloading =
    updateInfo?.isNativeUpdate &&
    !updateInfo.readyToInstall &&
    updateInfo.downloadProgress != null;

  /**
   * Phase 2C.6: download a sanitized diagnostic bundle. The /api/doctor/export
   * endpoint already exists and includes the cached diagnosis + recent runtime
   * logs + provider resolution chain, with API keys / URLs / paths sanitized.
   * UI just fetches it and triggers a JSON download — no new backend.
   *
   * This replaces the previous "导出运行日志" copy that didn't have a real
   * action behind it; everything the user wants for issue-filing or local
   * inspection is in the bundle.
   */
  const handleExportDiagnostics = async () => {
    if (exportingDiagnostics) return;
    setExportingDiagnostics(true);
    try {
      const res = await fetch("/api/doctor/export");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `codepilot-diagnostics-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Silent on failure — user can retry; no toast plumbing on this page.
    } finally {
      setExportingDiagnostics(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-sm font-medium">{t("settings.about" as TranslationKey)}</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {t("settings.aboutDesc" as TranslationKey)}
        </p>
      </div>

      {/* Version + update check. Same logic as the legacy UpdateCard
          but rendered as a single inline row so it matches the rest
          of About visually. */}
      <SettingsCard>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">{t("settings.codepilot")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("settings.version", { version: APP_VERSION })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {updateInfo?.updateAvailable && !checking && (
              updateInfo.readyToInstall ? (
                <Button size="sm" onClick={quitAndInstall}>
                  {t("update.restartToUpdate")}
                </Button>
              ) : updateInfo.isNativeUpdate && !isDownloading ? (
                <Button size="sm" onClick={downloadUpdate}>
                  {t("update.installUpdate")}
                </Button>
              ) : !updateInfo.isNativeUpdate ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(updateInfo.releaseUrl, "_blank")}
                >
                  {t("settings.viewRelease")}
                </Button>
              ) : null
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={checkForUpdates}
              disabled={checking}
              className="gap-2"
            >
              {checking ? (
                <SpinnerGap size={14} className="animate-spin" />
              ) : (
                <ArrowClockwise size={14} />
              )}
              {checking ? t("settings.checking") : t("settings.checkForUpdates")}
            </Button>
          </div>
        </div>

        {updateInfo && !checking && (
          <div className="mt-3">
            {updateInfo.updateAvailable ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${updateInfo.readyToInstall ? "bg-status-success" : isDownloading ? "bg-status-warning animate-pulse" : "bg-primary"}`}
                  />
                  <span className="text-sm">
                    {updateInfo.readyToInstall
                      ? t("update.readyToInstall", { version: updateInfo.latestVersion })
                      : isDownloading
                        ? `${t("update.downloading")} ${Math.round(updateInfo.downloadProgress!)}%`
                        : t("settings.updateAvailable", { version: updateInfo.latestVersion })}
                  </span>
                  {updateInfo.releaseNotes && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs text-muted-foreground"
                      onClick={() => setShowDialog(true)}
                    >
                      {t("gallery.viewDetails")}
                    </Button>
                  )}
                </div>
                {isDownloading && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(updateInfo.downloadProgress!, 100)}%` }}
                    />
                  </div>
                )}
                {updateInfo.lastError && (
                  <p className="text-xs text-status-error-foreground">{updateInfo.lastError}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("settings.latestVersion")}</p>
            )}
          </div>
        )}
      </SettingsCard>

      {/* Platform info — "what build am I running" surfaces here so a
          user filing a bug report can copy the exact line. */}
      <SettingsCard
        title={isZh ? "平台信息" : "Platform"}
        description={isZh ? "当前运行环境" : "Current build environment"}
      >
        <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground shrink-0">
              {isZh ? "操作系统" : "OS"}
            </span>
            <span className="text-xs text-foreground/85">{platform.os}</span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground shrink-0">
              {isZh ? "运行模式" : "Channel"}
            </span>
            <span className="text-xs text-foreground/85">{platform.channel}</span>
          </div>
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground shrink-0">
              {isZh ? "应用版本" : "App version"}
            </span>
            <span className="text-xs text-foreground/85">v{APP_VERSION}</span>
          </div>
        </div>
      </SettingsCard>

      {/* Account info — shown only when the underlying provider
          surfaces it. Read-only display; account management itself
          happens inside the provider that owns the credential
          (Anthropic OAuth, ChatGPT Plus OAuth, etc.). */}
      {accountInfo && (
        <SettingsCard title={t("settings.accountInfo" as TranslationKey)}>
          <div className="space-y-1">
            {accountInfo.email && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("settings.email" as TranslationKey)}:
                </span>{" "}
                {accountInfo.email}
              </p>
            )}
            {accountInfo.organization && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("settings.organization" as TranslationKey)}:
                </span>{" "}
                {accountInfo.organization}
              </p>
            )}
            {accountInfo.subscriptionType && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("settings.subscription" as TranslationKey)}:
                </span>{" "}
                {accountInfo.subscriptionType}
              </p>
            )}
          </div>
        </SettingsCard>
      )}

      {/* Support & logs (Phase 2C.6 rename).
          The previous wording was "诊断与维护 — 运行连接诊断、导出运行日志…"
          which over-promised: the existing diagnostic flow doesn't always
          identify root causes and the auto-repair path can mislead. The
          honest framing is: Health gives you status; if status doesn't
          explain it, grab a diagnostic bundle and inspect / share. Setup
          Center stays as the install / wizard entry, not a "fix anything"
          button. */}
      <SettingsCard
        title={isZh ? "支持与日志" : "Support & logs"}
        description={
          isZh
            ? "导出诊断包用于排查和反馈、运行设置向导、从其他客户端导入历史会话"
            : "Export a diagnostic bundle to investigate or share, run the setup wizard, import past chat sessions"
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={handleExportDiagnostics}
            disabled={exportingDiagnostics}
          >
            {exportingDiagnostics ? (
              <SpinnerGap size={14} className="animate-spin" />
            ) : (
              <FileArrowDown size={14} />
            )}
            {isZh ? "导出诊断包" : "Export diagnostic bundle"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => window.dispatchEvent(new CustomEvent("open-setup-center"))}
          >
            <Stethoscope size={14} />
            {isZh ? "运行设置向导" : "Run setup wizard"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => setImportDialogOpen(true)}
          >
            <FileArrowDown size={14} />
            {t("cli.importButton" as TranslationKey)}
          </Button>
        </div>
        <ImportSessionDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />
      </SettingsCard>

      {/* External links. Fixed URLs, opened in new tab. */}
      <SettingsCard
        title={isZh ? "文档与反馈" : "Documentation & feedback"}
        description={isZh ? "了解更多或报告问题" : "Learn more or report an issue"}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => window.open("https://github.com/op7418/CodePilot", "_blank")}
          >
            <ArrowSquareOut size={14} />
            GitHub
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => window.open("https://github.com/op7418/CodePilot/issues", "_blank")}
          >
            <ArrowSquareOut size={14} />
            {isZh ? "提交反馈" : "Submit feedback"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => window.open("https://github.com/op7418/CodePilot/releases", "_blank")}
          >
            <ArrowSquareOut size={14} />
            {isZh ? "Release Notes" : "Release notes"}
          </Button>
        </div>
      </SettingsCard>
    </div>
  );
}
