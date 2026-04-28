"use client";

/**
 * Settings → Overview — the dashboard of the Settings shell.
 *
 * Not "another settings page": a status summary that lets the user see
 * the whole Agent stack at a glance and jump to whichever section they
 * actually need.
 *
 * Five cards, one per concern, each with a single primary action:
 *
 *   1. Runtime              → "去 Runtime"   (status, fallback, why)
 *   2. New-chat default     → "去服务商" / "去模型"
 *   3. Models exposure      → "去模型"       (enabled / total / manual)
 *   4. Assistant Workspace  → "去助理"
 *   5. System               → "运行诊断"     (updates + warnings)
 *
 * Resolution helpers (`computeEffectiveRuntime`, `resolveNewChatDefault`)
 * are reused from `src/lib/runtime/effective.ts` so this surface and
 * Settings → Runtime always agree on which runtime is currently in
 * effect and what the next chat would resolve to.
 */

import { useState, useEffect, useCallback } from "react";
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
  Warning,
  CaretRight,
  ArrowsClockwise,
} from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  computeEffectiveRuntime,
  resolveNewChatDefault,
  runtimeDisplayLabel,
  type AgentRuntime,
} from "@/lib/runtime/effective";
import type { TranslationKey } from "@/i18n";

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
  // Runtime
  agentRuntime: string;
  cliEnabled: boolean;
  // Resolved new-chat default
  resolvedRuntimeFromApi: string | null;
  defaultProviderName: string | null;
  defaultModelLabel: string | null;
  noCompatibleProvider: boolean;
  // Models aggregate
  modelsTotal: number;
  modelsEnabled: number;
  modelsManualEnabled: number;
  modelsManualHidden: number;
  // Workspace
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

interface OverviewCardProps {
  icon: React.ReactNode;
  title: string;
  /** Tone of the leading status dot; matches design.md status pill colors. */
  tone: "success" | "warning" | "muted";
  children: React.ReactNode;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
}

function OverviewCard({
  icon,
  title,
  tone,
  children,
  primaryActionLabel,
  onPrimaryAction,
}: OverviewCardProps) {
  const dotTone: Record<typeof tone, string> = {
    success: "bg-status-success-foreground",
    warning: "bg-status-warning-foreground",
    muted: "bg-muted-foreground",
  };
  return (
    <div className="rounded-lg bg-card border border-border/50 p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="size-7 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <h3 className="text-sm font-semibold leading-tight flex-1 min-w-0">{title}</h3>
        <span className={cn("size-1.5 rounded-full shrink-0", dotTone[tone])} />
      </div>
      <div className="text-xs text-foreground/85 space-y-1.5">{children}</div>
      <div className="pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={onPrimaryAction}
        >
          {primaryActionLabel}
          <CaretRight size={12} weight="bold" />
        </Button>
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
      // We need per-row enable_source to count manual_enabled / manual_hidden,
      // which the picker-feed endpoint doesn't expose. Fall back to per-
      // provider /models?all=1 fetches to get those counts.
      if (modelsAllRes.ok) {
        const data = (await modelsAllRes.json()) as { groups?: ProviderModelGroup[] };
        const groups = data.groups ?? [];
        let total = 0;
        let enabled = 0;
        for (const g of groups) {
          total += g.total_count ?? g.models.length;
          enabled += g.models.length; // groups returned here are picker-feed (enabled-only)
        }
        next.modelsTotal = total;
        next.modelsEnabled = enabled;

        // Per-provider deep fetch for manual_enabled / manual_hidden counts.
        // These tell the user "you've made N decisions that survive every
        // refresh" — a useful proxy for "have I actually customized this".
        // Skip the env / openai-oauth synthetic groups (no DB rows).
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

  // Listener — refetch when the user changes provider / models / runtime
  // settings in another section. The dashboard should reflect their
  // changes when they bounce back here.
  useEffect(() => {
    const handler = () => { fetchAll(); };
    window.addEventListener("provider-changed", handler);
    return () => window.removeEventListener("provider-changed", handler);
  }, [fetchAll]);

  const navTo = (hash: string) => {
    if (typeof window !== "undefined") {
      window.location.hash = hash;
    }
  };

  const cliConnected = !!claudeStatus?.connected;
  const effectiveRuntime: AgentRuntime = computeEffectiveRuntime(
    state.agentRuntime,
    state.cliEnabled,
    cliConnected,
  );
  const runtimeIsFallback =
    state.agentRuntime === "claude-code-sdk" && effectiveRuntime !== "claude-code-sdk";
  const runtimeLabel = runtimeDisplayLabel(effectiveRuntime);
  const claudeWarnings = claudeStatus?.warnings && claudeStatus.warnings.length > 0;

  if (state.loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
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
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-sm font-medium">{t("settings.overview" as TranslationKey)}</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {t("settings.overviewDesc" as TranslationKey)}
        </p>
      </div>

      {/* Card 1 — Runtime status. The single most-asked question on this
          page is "what's running my Agent right now"; surface it first. */}
      <OverviewCard
        icon={<Lightning size={14} weight="fill" className="text-status-success-foreground" />}
        title={isZh ? "运行环境" : "Runtime"}
        tone={runtimeIsFallback ? "warning" : "success"}
        primaryActionLabel={isZh ? "管理 Runtime" : "Manage Runtime"}
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

      {/* Card 2 — New chat default. Quick "if I open a new chat right
          now, who's it talking to?" — bridges Runtime and Providers. */}
      <OverviewCard
        icon={<Plug size={14} className="text-foreground/70" />}
        title={isZh ? "新会话默认" : "New chat default"}
        tone={state.noCompatibleProvider ? "warning" : "muted"}
        primaryActionLabel={isZh ? "管理服务商" : "Manage providers"}
        onPrimaryAction={() => navTo("#providers")}
      >
        {state.noCompatibleProvider ? (
          <p className="text-status-warning-foreground">
            {isZh
              ? `当前 Runtime（${runtimeLabel}）下没有可用的 provider/model。新会话将进入"无兼容服务"状态。`
              : `No provider / model is compatible with the current runtime (${runtimeLabel}). New chats will land in the "no compatible provider" state.`}
          </p>
        ) : (
          <>
            <p>
              <span className="text-muted-foreground">{isZh ? "Provider：" : "Provider: "}</span>
              <span className="font-medium">
                {state.defaultProviderName ?? (isZh ? "未配置" : "Not configured")}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">{isZh ? "模型：" : "Model: "}</span>
              <span className="font-medium">
                {state.defaultModelLabel ?? (isZh ? "未配置" : "Not configured")}
              </span>
            </p>
          </>
        )}
      </OverviewCard>

      {/* Card 3 — Models exposure. enabled / total + manual_* counts so
          the user sees both raw inventory and how customized they've made it. */}
      <OverviewCard
        icon={<Brain size={14} className="text-foreground/70" />}
        title={isZh ? "模型暴露" : "Models exposure"}
        tone="muted"
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
        {(state.modelsManualEnabled > 0 || state.modelsManualHidden > 0) && (
          <p className="text-muted-foreground">
            {isZh
              ? `手动启用 ${state.modelsManualEnabled} · 手动隐藏 ${state.modelsManualHidden}（刷新不会覆盖）`
              : `${state.modelsManualEnabled} manually enabled · ${state.modelsManualHidden} manually hidden (preserved on refresh)`}
          </p>
        )}
      </OverviewCard>

      {/* Card 4 — Assistant Workspace. Just configured / not yet —
          deep config lives on the dedicated page. */}
      <OverviewCard
        icon={<UserCircle size={14} className="text-foreground/70" />}
        title={isZh ? "助理工作空间" : "Assistant Workspace"}
        tone={state.workspaceConfigured ? "success" : "muted"}
        primaryActionLabel={isZh ? "管理助理" : "Manage assistant"}
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

      {/* Card 5 — System status. Updates / diagnose / Setup Center
          entry. Replaces what used to live in General. */}
      <OverviewCard
        icon={<Stethoscope size={14} className="text-foreground/70" />}
        title={isZh ? "系统" : "System"}
        tone={updateInfo?.updateAvailable ? "warning" : "success"}
        primaryActionLabel={isZh ? "查看 / 关于" : "View / About"}
        onPrimaryAction={() => navTo("#about")}
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
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => window.dispatchEvent(new CustomEvent("open-setup-center"))}
          >
            <Stethoscope size={12} />
            {isZh ? "运行设置向导" : "Run setup wizard"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={checkForUpdates}
            disabled={checking}
          >
            <ArrowsClockwise size={12} className={checking ? "animate-spin" : undefined} />
            {isZh ? "检查更新" : "Check updates"}
          </Button>
        </div>
      </OverviewCard>
    </div>
  );
}
