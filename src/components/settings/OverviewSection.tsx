"use client";

/**
 * Settings → Overview — the dashboard of the Settings shell.
 *
 * Three layers, top to bottom:
 *
 *   1. Getting Started checklist — 4 items (provider / models / runtime
 *      / workspace). Hidden once 4/4 done. Each pending item carries its
 *      own jump button so the user can pick whichever step they want.
 *   2. 6 status cards in a 2-col grid: Runtime, Providers, Models,
 *      Assistant Workspace, Update / About, Setup / Diagnostics. Cards
 *      that need attention pick up an accent (`status-warning-muted`),
 *      already-configured cards stay flat — so the page no longer reads
 *      as "all uniform black tiles".
 *   3. Token usage heatmap — GitHub-style 7×N grid + summary stats over
 *      the chosen 30 / 90 / 365 day window. Reuses `/api/usage/stats`.
 *
 * Resolution helpers (`computeEffectiveRuntime`, `resolveNewChatDefault`)
 * are reused from `src/lib/runtime/effective.ts` so this surface and
 * Settings → Runtime always agree on which runtime is currently in
 * effect and what the next chat would resolve to.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useAccountInfo } from "@/hooks/useAccountInfo";
import { useUpdate } from "@/hooks/useUpdate";
import { useClaudeStatus } from "@/hooks/useClaudeStatus";
import { Button } from "@/components/ui/button";
import {
  Lightning,
  Plug,
  Brain,
  UserCircle,
  Stethoscope,
  CheckCircle,
  Circle,
  Warning,
  CaretRight,
  ArrowsClockwise,
  Info,
} from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  computeEffectiveRuntime,
  resolveNewChatDefault,
  runtimeDisplayLabel,
  type AgentRuntime,
} from "@/lib/runtime/effective";
import type { TranslationKey } from "@/i18n";
import { OverviewHeatmap } from "./OverviewHeatmap";

interface ProviderModelGroup {
  provider_id: string;
  provider_name: string;
  models: Array<{ value: string; label: string }>;
  total_count?: number;
}

interface ModelRow {
  model_id: string;
  enabled: number;
  enable_source: string;
}

interface OverviewState {
  loading: boolean;
  agentRuntime: string;
  cliEnabled: boolean;
  resolvedRuntimeFromApi: string | null;
  defaultProviderName: string | null;
  defaultModelLabel: string | null;
  noCompatibleProvider: boolean;
  providersConfigured: number;
  modelsTotal: number;
  modelsEnabled: number;
  modelsManualEnabled: number;
  modelsManualHidden: number;
  workspaceConfigured: boolean;
  workspaceName: string | null;
}

const initialState: OverviewState = {
  loading: true,
  agentRuntime: "claude-code-sdk",
  cliEnabled: true,
  resolvedRuntimeFromApi: null,
  defaultProviderName: null,
  defaultModelLabel: null,
  noCompatibleProvider: false,
  providersConfigured: 0,
  modelsTotal: 0,
  modelsEnabled: 0,
  modelsManualEnabled: 0,
  modelsManualHidden: 0,
  workspaceConfigured: false,
  workspaceName: null,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ChecklistItem {
  id: string;
  label: string;
  desc: string;
  done: boolean;
  actionLabel: string;
  onAction: () => void;
}

function GettingStartedBar({
  items,
  isZh,
  t,
}: {
  items: ChecklistItem[];
  isZh: boolean;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const total = items.length;
  const done = items.filter((i) => i.done).length;

  return (
    <div className="rounded-lg border border-border/50 bg-card overflow-hidden">
      {/* Header — title + N/M completed counter */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/40">
        <h3 className="text-sm font-semibold">
          {t("overview.gettingStarted" as TranslationKey)}
        </h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {t("overview.completed" as TranslationKey, { done, total })}
        </span>
      </div>

      {/* Items — pending first (so the user sees what's left), then done */}
      <ul className="divide-y divide-border/40">
        {[...items].sort((a, b) => Number(a.done) - Number(b.done)).map((item) => (
          <li
            key={item.id}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5",
              item.done ? "bg-transparent" : "bg-status-warning-muted/20",
            )}
          >
            <span className="shrink-0">
              {item.done ? (
                <CheckCircle
                  size={16}
                  weight="fill"
                  className="text-status-success-foreground"
                />
              ) : (
                <Circle size={16} className="text-muted-foreground" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-xs font-medium leading-tight",
                  item.done ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {item.label}
              </p>
              {!item.done && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {item.desc}
                </p>
              )}
            </div>
            {!item.done && (
              <Button
                size="sm"
                onClick={item.onAction}
                className="h-7 px-3 text-[11px] shrink-0"
              >
                {item.actionLabel}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {/* Optional footer when all done — but the bar is hidden in that case */}
      {done === total && (
        <div className="px-4 py-2.5 text-[11px] text-status-success-foreground bg-status-success-muted/30">
          {isZh ? "✓ 全部就绪" : "✓ All set"}
        </div>
      )}
    </div>
  );
}

interface OverviewCardProps {
  icon: React.ReactNode;
  title: string;
  /** Tone of the leading status dot + card accent. */
  tone: "success" | "warning" | "muted";
  children: React.ReactNode;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  footer?: React.ReactNode;
}

function OverviewCard({
  icon,
  title,
  tone,
  children,
  primaryActionLabel,
  onPrimaryAction,
  footer,
}: OverviewCardProps) {
  const dotTone: Record<typeof tone, string> = {
    success: "bg-status-success-foreground",
    warning: "bg-status-warning-foreground",
    muted: "bg-muted-foreground/40",
  };
  const needsAttention = tone === "warning";
  return (
    <div
      className={cn(
        "rounded-lg border p-5 flex flex-col gap-3 h-full",
        needsAttention
          ? "border-status-warning-border bg-status-warning-muted/30"
          : "border-border/50 bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-foreground/65">{icon}</span>
        <h3 className="text-sm font-semibold leading-tight flex-1 min-w-0">
          {title}
        </h3>
        <span className={cn("size-1.5 rounded-full shrink-0", dotTone[tone])} />
      </div>
      <div className="text-xs text-foreground/85 space-y-1.5 flex-1">
        {children}
      </div>
      <div className="pt-1 flex items-center gap-2 flex-wrap">
        <Button
          variant={needsAttention ? "default" : "ghost"}
          size="sm"
          className={cn(
            "gap-1 text-xs",
            needsAttention ? "h-7 px-3" : "-ml-2 text-muted-foreground hover:text-foreground",
          )}
          onClick={onPrimaryAction}
        >
          {primaryActionLabel}
          {!needsAttention && <CaretRight size={12} weight="bold" />}
        </Button>
        {footer}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OverviewSection() {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";
  const [state, setState] = useState<OverviewState>(initialState);
  const { accountInfo } = useAccountInfo();
  const { updateInfo, checking, checkForUpdates } = useUpdate();
  const { status: claudeStatus } = useClaudeStatus();

  const fetchAll = useCallback(async () => {
    try {
      const [appRes, modelsAutoRes, modelsAllRes, globalOptRes, workspaceRes, workspaceSummaryRes] =
        await Promise.all([
          fetch("/api/settings/app"),
          fetch("/api/providers/models?runtime=auto"),
          fetch("/api/providers/models"),
          fetch("/api/providers/options?providerId=__global__"),
          fetch("/api/settings/workspace"),
          fetch("/api/workspace/summary"),
        ]);

      const next = { ...initialState, loading: false };

      if (appRes.ok) {
        const appData = await appRes.json();
        const appSettings = appData.settings || {};
        next.agentRuntime = appSettings.agent_runtime || "claude-code-sdk";
        next.cliEnabled = appSettings.cli_enabled !== "false";
      }

      // Runtime-filtered groups → resolve new-chat default via the same
      // chain Settings → Runtime + chat init both use.
      if (modelsAutoRes.ok) {
        const data = (await modelsAutoRes.json()) as {
          groups?: ProviderModelGroup[];
          default_provider_id?: string;
          runtime_applied?: string;
        };
        next.resolvedRuntimeFromApi = data.runtime_applied ?? null;
        const groups = data.groups ?? [];
        if (groups.length === 0) {
          next.noCompatibleProvider = true;
        } else {
          let globalDefaultModel = "";
          let globalDefaultProvider = "";
          if (globalOptRes.ok) {
            const globalData = await globalOptRes.json();
            globalDefaultModel = globalData?.options?.default_model ?? "";
            globalDefaultProvider = globalData?.options?.default_model_provider ?? "";
          }
          let savedProviderId = "";
          let savedModel = "";
          if (typeof window !== "undefined") {
            savedProviderId = localStorage.getItem("codepilot:last-provider-id") ?? "";
            savedModel = localStorage.getItem("codepilot:last-model") ?? "";
          }
          const resolved = resolveNewChatDefault({
            groups,
            apiDefaultProviderId: data.default_provider_id,
            globalDefaultModel,
            globalDefaultProvider,
            savedProviderId,
            savedModel,
          });
          if (resolved) {
            next.defaultProviderName = resolved.providerName;
            next.defaultModelLabel = resolved.modelLabel;
          }
        }
      }

      // Unfiltered group list — used for the models aggregate counts.
      if (modelsAllRes.ok) {
        const data = (await modelsAllRes.json()) as { groups?: ProviderModelGroup[] };
        const groups = data.groups ?? [];
        next.providersConfigured = groups.length;
        let total = 0;
        let enabled = 0;
        for (const g of groups) {
          total += g.total_count ?? g.models.length;
          enabled += g.models.length;
        }
        next.modelsTotal = total;
        next.modelsEnabled = enabled;

        // Per-provider deep fetch for manual_enabled / manual_hidden counts.
        const dbGroups = groups.filter(
          (g) => g.provider_id !== "env" && g.provider_id !== "openai-oauth",
        );
        await Promise.all(
          dbGroups.map(async (g) => {
            try {
              const r = await fetch(`/api/providers/${g.provider_id}/models?all=1`);
              if (!r.ok) return;
              const j = (await r.json()) as { models?: ModelRow[] };
              for (const m of j.models ?? []) {
                if (m.enable_source === "manual_enabled") next.modelsManualEnabled += 1;
                else if (m.enable_source === "manual_hidden") next.modelsManualHidden += 1;
              }
            } catch {
              /* ignore */
            }
          }),
        );
      }

      // Assistant Workspace status — boolean configured + optional name.
      if (workspaceRes.ok) {
        const wsData = await workspaceRes.json();
        if (wsData?.path) next.workspaceConfigured = true;
      }
      if (workspaceSummaryRes.ok) {
        const summary = await workspaceSummaryRes.json();
        if (summary?.name) next.workspaceName = summary.name;
        if (summary?.configured) next.workspaceConfigured = true;
      }

      setState(next);
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const handler = () => { fetchAll(); };
    window.addEventListener("provider-changed", handler);
    return () => window.removeEventListener("provider-changed", handler);
  }, [fetchAll]);

  const navTo = useCallback((hash: string) => {
    if (typeof window !== "undefined") {
      window.location.hash = hash;
    }
  }, []);

  const cliConnected = !!claudeStatus?.connected;
  const effectiveRuntime: AgentRuntime = computeEffectiveRuntime(
    state.agentRuntime,
    state.cliEnabled,
    cliConnected,
  );
  const runtimeIsFallback =
    state.agentRuntime === "claude-code-sdk" && effectiveRuntime !== "claude-code-sdk";
  const runtimeLabel = runtimeDisplayLabel(effectiveRuntime);
  const claudeWarnings = !!(claudeStatus?.warnings && claudeStatus.warnings.length > 0);

  // Build the checklist. Tasks resolve once per render; once a task is
  // done it stays "done" until the underlying state changes — no stuck-
  // checked rows.
  const checklist: ChecklistItem[] = useMemo(() => [
    {
      id: "connect-provider",
      label: t("overview.checklistConnectProvider" as TranslationKey),
      desc: t("overview.checklistConnectProviderDesc" as TranslationKey),
      done: state.providersConfigured > 0,
      actionLabel: t("overview.actionGoConfigure" as TranslationKey),
      onAction: () => navTo("#providers"),
    },
    {
      id: "enable-models",
      label: t("overview.checklistEnableModels" as TranslationKey),
      desc: t("overview.checklistEnableModelsDesc" as TranslationKey),
      // Only ask once a provider exists; "no provider" is covered above.
      done: state.providersConfigured === 0 || state.modelsEnabled > 0,
      actionLabel: t("overview.actionGoConfigure" as TranslationKey),
      onAction: () => navTo("#models"),
    },
    {
      id: "verify-runtime",
      label: t("overview.checklistVerifyRuntime" as TranslationKey),
      desc: t("overview.checklistVerifyRuntimeDesc" as TranslationKey),
      done: !runtimeIsFallback && !claudeWarnings,
      actionLabel: t("overview.actionGoConfigure" as TranslationKey),
      onAction: () => navTo("#runtime"),
    },
    {
      id: "configure-workspace",
      label: t("overview.checklistConfigureWorkspace" as TranslationKey),
      desc: t("overview.checklistConfigureWorkspaceDesc" as TranslationKey),
      done: state.workspaceConfigured,
      actionLabel: t("overview.actionGoConfigure" as TranslationKey),
      onAction: () => navTo("#assistant"),
    },
  ], [
    t, navTo,
    state.providersConfigured,
    state.modelsEnabled,
    runtimeIsFallback,
    claudeWarnings,
    state.workspaceConfigured,
  ]);

  const allDone = checklist.every((c) => c.done);

  if (state.loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h2 className="text-sm font-medium">{t("settings.overview" as TranslationKey)}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t("settings.overviewDesc" as TranslationKey)}
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-border/50 bg-card/50 p-10 text-center">
          <p className="text-xs text-muted-foreground">{isZh ? "加载中…" : "Loading…"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-sm font-medium">{t("settings.overview" as TranslationKey)}</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {t("settings.overviewDesc" as TranslationKey)}
        </p>
      </div>

      {/* Top — Getting Started checklist (hidden once everything done) */}
      {!allDone && <GettingStartedBar items={checklist} isZh={isZh} t={t} />}

      {/* Middle — 6 status cards in a 2-col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1 — Runtime status */}
        <OverviewCard
          icon={<Lightning size={16} weight={runtimeIsFallback ? "regular" : "fill"} />}
          title={isZh ? "运行环境" : "Runtime"}
          tone={runtimeIsFallback ? "warning" : "success"}
          primaryActionLabel={
            runtimeIsFallback
              ? isZh ? "去 Runtime 修复" : "Fix in Runtime"
              : isZh ? "管理 Runtime" : "Manage Runtime"
          }
          onPrimaryAction={() => navTo("#runtime")}
        >
          <p>
            <span className="text-muted-foreground">
              {isZh ? "当前默认：" : "Current default: "}
            </span>
            <span className="font-medium">{runtimeLabel}</span>
            {runtimeIsFallback && (
              <span className="ml-1 text-status-warning-foreground">
                {!state.cliEnabled
                  ? (isZh ? "（CLI 已禁用，自动降级）" : "(CLI disabled, fallback)")
                  : (isZh ? "（Claude Code 不可用，自动降级）" : "(Claude Code unavailable, fallback)")}
              </span>
            )}
          </p>
          {claudeWarnings && (
            <p className="text-status-warning-foreground flex items-start gap-1">
              <Warning size={12} weight="fill" className="mt-0.5 shrink-0" />
              <span>{isZh ? "Claude Code 有兼容性提示" : "Claude Code reports compatibility warnings"}</span>
            </p>
          )}
        </OverviewCard>

        {/* Card 2 — Providers (provider count + new-chat default) */}
        <OverviewCard
          icon={<Plug size={16} />}
          title={isZh ? "服务商" : "Providers"}
          tone={state.noCompatibleProvider ? "warning" : "muted"}
          primaryActionLabel={isZh ? "管理服务商" : "Manage providers"}
          onPrimaryAction={() => navTo("#providers")}
        >
          <p>
            <span className="text-muted-foreground">
              {isZh ? "已接入：" : "Configured: "}
            </span>
            <span className="font-medium">{state.providersConfigured}</span>
          </p>
          {state.noCompatibleProvider ? (
            <p className="text-status-warning-foreground">
              {isZh
                ? `当前 Runtime（${runtimeLabel}）下没有可用的 provider/model。`
                : `No provider / model is compatible with the current runtime (${runtimeLabel}).`}
            </p>
          ) : (
            <>
              <p>
                <span className="text-muted-foreground">{isZh ? "默认服务商：" : "Default provider: "}</span>
                <span className="font-medium">
                  {state.defaultProviderName ?? (isZh ? "未配置" : "Not configured")}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">{isZh ? "默认模型：" : "Default model: "}</span>
                <span className="font-medium">
                  {state.defaultModelLabel ?? (isZh ? "未配置" : "Not configured")}
                </span>
              </p>
            </>
          )}
        </OverviewCard>

        {/* Card 3 — Models exposure */}
        <OverviewCard
          icon={<Brain size={16} />}
          title={isZh ? "模型暴露" : "Models exposure"}
          tone={state.modelsEnabled === 0 && state.providersConfigured > 0 ? "warning" : "muted"}
          primaryActionLabel={isZh ? "管理模型" : "Manage models"}
          onPrimaryAction={() => navTo("#models")}
        >
          <p>
            <span className="text-muted-foreground">
              {isZh ? "可见 / 全部：" : "Visible / total: "}
            </span>
            <span className="font-medium">
              {state.modelsEnabled} / {state.modelsTotal}
            </span>
          </p>
          {state.modelsEnabled === 0 && state.providersConfigured > 0 ? (
            <p className="text-status-warning-foreground">
              {isZh
                ? "你已经接入了服务商，但没有任何模型对 picker 可见。"
                : "You've connected a provider, but no models are visible to the picker."}
            </p>
          ) : (state.modelsManualEnabled > 0 || state.modelsManualHidden > 0) ? (
            <p className="text-muted-foreground">
              {isZh
                ? `手动启用 ${state.modelsManualEnabled} · 手动隐藏 ${state.modelsManualHidden}（刷新不会覆盖）`
                : `${state.modelsManualEnabled} manually enabled · ${state.modelsManualHidden} manually hidden (preserved on refresh)`}
            </p>
          ) : null}
        </OverviewCard>

        {/* Card 4 — Assistant Workspace */}
        <OverviewCard
          icon={<UserCircle size={16} />}
          title={isZh ? "助理工作空间" : "Assistant Workspace"}
          tone={state.workspaceConfigured ? "success" : "warning"}
          primaryActionLabel={
            state.workspaceConfigured
              ? isZh ? "管理助理" : "Manage assistant"
              : isZh ? "去配置" : "Configure"
          }
          onPrimaryAction={() => navTo("#assistant")}
        >
          {state.workspaceConfigured ? (
            <p>
              <CheckCircle
                size={12}
                weight="fill"
                className="inline-block text-status-success-foreground mr-1 -mt-0.5"
              />
              {state.workspaceName
                ? (isZh ? `已配置：${state.workspaceName}` : `Configured: ${state.workspaceName}`)
                : (isZh ? "已配置工作空间" : "Workspace configured")}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {isZh
                ? "尚未配置 — 设定一个本地工作目录开始使用助理"
                : "Not yet configured — pick a local working directory to start"}
            </p>
          )}
        </OverviewCard>

        {/* Card 5 — Update / About */}
        <OverviewCard
          icon={<Info size={16} />}
          title={isZh ? "版本与账户" : "Update & About"}
          tone={updateInfo?.updateAvailable ? "warning" : "success"}
          primaryActionLabel={isZh ? "查看关于" : "View About"}
          onPrimaryAction={() => navTo("#about")}
          footer={
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={checkForUpdates}
              disabled={checking}
            >
              <ArrowsClockwise size={12} className={checking ? "animate-spin" : undefined} />
              {checking ? (isZh ? "检查中…" : "Checking…") : (isZh ? "检查更新" : "Check updates")}
            </Button>
          }
        >
          {updateInfo?.updateAvailable ? (
            <p className="text-status-warning-foreground flex items-start gap-1">
              <Warning size={12} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                {isZh
                  ? `有新版本 v${updateInfo.latestVersion} 可用`
                  : `Update available: v${updateInfo.latestVersion}`}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              {checking
                ? (isZh ? "正在检查更新…" : "Checking for updates…")
                : (isZh ? "已是最新版本" : "Up to date")}
            </p>
          )}
          {accountInfo?.email && (
            <p className="text-muted-foreground">
              {isZh ? "账户：" : "Account: "}
              <span className="text-foreground/85">{accountInfo.email}</span>
            </p>
          )}
        </OverviewCard>

        {/* Card 6 — Setup Center / Diagnostics */}
        <OverviewCard
          icon={<Stethoscope size={16} />}
          title={isZh ? "设置 / 诊断" : "Setup / Diagnostics"}
          tone={claudeWarnings ? "warning" : "muted"}
          primaryActionLabel={isZh ? "运行设置向导" : "Run setup wizard"}
          onPrimaryAction={() => window.dispatchEvent(new CustomEvent("open-setup-center"))}
          footer={
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => navTo("#about")}
            >
              {isZh ? "导出日志" : "Export logs"}
              <CaretRight size={12} weight="bold" />
            </Button>
          }
        >
          {claudeWarnings ? (
            <p className="text-status-warning-foreground flex items-start gap-1">
              <Warning size={12} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                {isZh
                  ? "检测到 Claude Code 兼容性提示，建议运行诊断"
                  : "Claude Code compatibility warnings detected — run diagnose"}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              {isZh
                ? "运行连接诊断、导出运行日志、重新跑安装向导"
                : "Run connectivity diagnose, export logs, replay setup wizard"}
            </p>
          )}
        </OverviewCard>
      </div>

      {/* Bottom — Token usage activity heatmap */}
      <OverviewHeatmap isZh={isZh} onJumpToDetails={() => navTo("#usage")} />
    </div>
  );
}
