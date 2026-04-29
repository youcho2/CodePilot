"use client";

/**
 * Phase 3.1 v1 — Run Cockpit (chat header status bar).
 *
 * One thin row above MessageList showing what THIS chat is actually
 * routed through right now:
 *   ⚡ Runtime label
 *   🔌 Provider · 🧠 Model
 *   Auto / Pinned mode tag
 *   ● health dot
 *
 * Read-only and additive — does not write state, does not duplicate
 * the chat-page invalid-default banner. Each segment is a button that
 * opens the canonical Settings page for that concern (Runtime / Models
 * / Health). Health dot reflects the same severity calc the Health
 * page produces, so the two surfaces never disagree.
 *
 * Data layer reuses `useOverviewData` (the same hook Overview /
 * Health already consume) and `useClaudeStatus` for the CLI bit. No
 * new endpoints, no new state — refetches via `provider-changed`
 * dispatch like the rest of Settings.
 */

import { useMemo } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useClaudeStatus } from "@/hooks/useClaudeStatus";
import {
  Lightning,
  Plug,
  Brain,
  PushPin,
} from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  computeEffectiveRuntime,
  runtimeDisplayLabel,
  type AgentRuntime,
} from "@/lib/runtime/effective";
import { useOverviewData } from "@/components/settings/useOverviewData";

type Severity = "ok" | "warn" | "error";

const SEVERITY_DOT: Record<Severity, string> = {
  ok: "bg-status-success-foreground",
  warn: "bg-status-warning-foreground",
  error: "bg-destructive",
};

function navTo(hash: string) {
  if (typeof window !== "undefined") {
    window.location.href = `/settings${hash}`;
  }
}

export function RunCockpit() {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";
  const state = useOverviewData();
  const { status: claudeStatus } = useClaudeStatus();

  const cliConnected = !!claudeStatus?.connected;
  const effectiveRuntime: AgentRuntime = computeEffectiveRuntime(
    state.agentRuntime,
    state.cliEnabled,
    cliConnected,
  );
  const runtimeLabel = runtimeDisplayLabel(effectiveRuntime);
  const runtimeFallback =
    state.agentRuntime === "claude-code-sdk" && effectiveRuntime !== "claude-code-sdk";

  // Mirror HealthSection's severity rollup so the dot here matches
  // what Health says. Worst row wins.
  const severity: Severity = useMemo(() => {
    if (state.loading) return "ok";
    if (state.providersConfigured === 0) return "error";
    if (state.modelsEnabled === 0) return "error";
    if (state.noCompatibleProvider) return "error";
    if (state.defaultInvalid) return "error";
    if (runtimeFallback) return "error";
    const claudeWarn = !!(claudeStatus?.warnings && claudeStatus.warnings.length > 0);
    if (claudeWarn) return "warn";
    if (state.agentRuntime === "claude-code-sdk" && !state.cliEnabled) return "warn";
    if (!state.workspaceConfigured) return "warn";
    return "ok";
  }, [state, claudeStatus, runtimeFallback]);

  // Don't render anything until the first fetch lands — the initial
  // state would briefly mis-classify (providers=0 → error) and the
  // cockpit would flicker red on every chat page load. Wait until we
  // actually have data.
  if (state.loading) return null;

  const providerLabel = state.defaultProviderName ?? (isZh ? "未配置" : "Not configured");
  const modelLabel = state.defaultModelLabel ?? (isZh ? "未配置" : "Not configured");
  const modeIsPinned = state.defaultMode === "pinned";
  const modeLabel = modeIsPinned ? (isZh ? "已固定" : "Pinned") : (isZh ? "Auto" : "Auto");

  // Tooltip lines per segment. Keep the cockpit chrome itself tiny —
  // tooltip is where the explanation goes, click is where the action
  // lives.
  const runtimeTip = runtimeFallback
    ? (isZh
        ? `运行环境：${runtimeLabel}（已自动降级）`
        : `Runtime: ${runtimeLabel} (auto-fallback)`)
    : (isZh ? `运行环境：${runtimeLabel}` : `Runtime: ${runtimeLabel}`);

  const defaultModeTip = state.defaultInvalid
    ? (isZh
        ? `默认模型已固定为 ${providerLabel} / ${modelLabel}，但当前 Runtime 下不可执行`
        : `Pinned default ${providerLabel} / ${modelLabel} not executable under current Runtime`)
    : modeIsPinned
      ? (isZh
          ? `已固定 ${providerLabel} / ${modelLabel} 为新会话默认`
          : `Pinned ${providerLabel} / ${modelLabel} as new-chat default`)
      : (isZh
          ? "Auto — 系统按当前 Runtime 自动选第一个合适模型"
          : "Auto — system picks the first compatible model");

  const healthTip = severity === "ok"
    ? (isZh ? "状态正常" : "All systems healthy")
    : severity === "warn"
      ? (isZh ? "存在 1 项以上提示" : "One or more warnings")
      : (isZh ? "存在阻塞问题" : "Blocking issues detected");

  return (
    <div
      className="flex items-center gap-2.5 border-b border-border/40 bg-card/40 px-3 py-1 text-[11px] text-muted-foreground"
      role="status"
      aria-label={isZh ? "本会话运行状态" : "This session's run status"}
    >
      {/* Runtime */}
      <button
        type="button"
        onClick={() => navTo("#runtime")}
        title={runtimeTip}
        className={cn(
          "flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground transition-colors",
          runtimeFallback && "text-status-warning-foreground",
        )}
      >
        <Lightning size={11} weight={runtimeFallback ? "regular" : "fill"} />
        <span className="font-medium">{runtimeLabel}</span>
      </button>

      <span aria-hidden className="text-border">·</span>

      {/* Provider · Model — single segment because picking provider
          and model are co-decided on the Models page anyway. */}
      <button
        type="button"
        onClick={() => navTo("#models")}
        title={defaultModeTip}
        className={cn(
          "flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground transition-colors min-w-0",
          state.defaultInvalid && "text-status-warning-foreground",
        )}
      >
        <Plug size={11} />
        <span className="truncate max-w-[120px]">{providerLabel}</span>
        <span aria-hidden className="opacity-50">/</span>
        <Brain size={11} />
        <span className="truncate max-w-[140px]">{modelLabel}</span>
      </button>

      <span aria-hidden className="text-border">·</span>

      {/* Default mode tag. Distinct visual: Pinned uses inverted
          chip (foreground → background) so it stands out the way the
          Models page status row does. Auto stays muted. */}
      <button
        type="button"
        onClick={() => navTo("#models")}
        title={defaultModeTip}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80 transition-opacity",
          modeIsPinned
            ? state.defaultInvalid
              ? "bg-status-warning-foreground text-background"
              : "bg-foreground text-background"
            : "bg-muted text-muted-foreground",
        )}
      >
        {modeIsPinned && <PushPin size={9} weight="fill" />}
        {modeLabel}
      </button>

      {/* Right-aligned health dot. Click → Health page. */}
      <button
        type="button"
        onClick={() => navTo("#health")}
        title={healthTip}
        className="ml-auto flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground transition-colors"
        aria-label={healthTip}
      >
        <span className={cn("size-1.5 rounded-full shrink-0", SEVERITY_DOT[severity])} />
        <span className="text-[10px]">{isZh ? "健康" : "Health"}</span>
      </button>
    </div>
  );
}
