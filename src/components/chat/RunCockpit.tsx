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
import { Button } from "@/components/ui/button";
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

interface RunCockpitProps {
  /** Current chat's selected provider id. Used to apply session-level
   *  runtime overrides (e.g. OpenAI OAuth providers can't run under
   *  Claude Code SDK and force native regardless of the global setting),
   *  matching the legacy `RuntimeBadge` behaviour the cockpit replaces. */
  providerId?: string;
}

export function RunCockpit({ providerId }: RunCockpitProps = {}) {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";
  const state = useOverviewData();
  const { status: claudeStatus } = useClaudeStatus();

  const cliConnected = !!claudeStatus?.connected;
  const settingRuntime: AgentRuntime = computeEffectiveRuntime(
    state.agentRuntime,
    state.cliEnabled,
    cliConnected,
  );
  // Session-level override: providers that are structurally incompatible
  // with Claude Code SDK (OpenAI OAuth, future non-Anthropic non-AI-SDK
  // bridges) force native regardless of the global preference. Same gate
  // the legacy RuntimeBadge applied on the chat header.
  const isNonAnthropicProvider = providerId === "openai-oauth";
  const effectiveRuntime: AgentRuntime = isNonAnthropicProvider
    ? "native"
    : settingRuntime;
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
  const runtimeTip = isNonAnthropicProvider
    ? (isZh
        ? `本次走 ${runtimeLabel}（OpenAI 模型不支持 Claude Code 引擎，已自动切换）`
        : `Routing through ${runtimeLabel} (OpenAI models can't use Claude Code, auto-switched)`)
    : runtimeFallback
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

  // Cockpit follows luma `<Button size="xs">` for every clickable
  // segment (no hand-rolled `px-* py-*` wrappers) so radius / hover
  // / focus ring all come from the shared token system. Pinned /
  // Auto pill uses design.md §Status badges colour pairs:
  //   Pinned  → `bg-primary text-primary-foreground` — neutral
  //              "user-elected" tone, distinct from
  //              success/warning/error which are reserved for
  //              abnormal states.
  //   Pinned + invalid → status-warning-muted pair, matching the
  //              chat banner / Health row's invalid state.
  //   Auto    → muted pair.
  return (
    <div
      className="flex items-center gap-1 border-b border-border/40 bg-card/40 px-3 py-1 text-[11px] text-muted-foreground"
      role="status"
      aria-label={isZh ? "本会话运行状态" : "This session's run status"}
    >
      {/* Runtime */}
      <Button
        variant="ghost"
        size="xs"
        onClick={() => navTo("#runtime")}
        title={runtimeTip}
        className={cn(
          "text-[11px] font-normal text-muted-foreground hover:text-foreground",
          runtimeFallback && "text-status-warning-foreground hover:text-status-warning-foreground",
        )}
      >
        <Lightning size={11} weight={runtimeFallback ? "regular" : "fill"} />
        <span className="font-medium">{runtimeLabel}</span>
      </Button>

      <span aria-hidden className="text-border px-0.5">·</span>

      {/* Provider · Model — single segment because picking provider
          and model are co-decided on the Models page anyway. */}
      <Button
        variant="ghost"
        size="xs"
        onClick={() => navTo("#models")}
        title={defaultModeTip}
        className={cn(
          "text-[11px] font-normal text-muted-foreground hover:text-foreground min-w-0",
          state.defaultInvalid && "text-status-warning-foreground hover:text-status-warning-foreground",
        )}
      >
        <Plug size={11} />
        <span className="truncate max-w-[120px]">{providerLabel}</span>
        <span aria-hidden className="opacity-50">/</span>
        <Brain size={11} />
        <span className="truncate max-w-[140px]">{modelLabel}</span>
      </Button>

      <span aria-hidden className="text-border px-0.5">·</span>

      {/* Default mode tag (Pinned / Auto). Stays a non-button
          inline element so the status pill geometry matches design.md
          §Status badges (rounded-full, two-colour token pair). */}
      <button
        type="button"
        onClick={() => navTo("#models")}
        title={defaultModeTip}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-80",
          modeIsPinned
            ? state.defaultInvalid
              ? "bg-status-warning-muted text-status-warning-foreground"
              : "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {modeIsPinned && <PushPin size={9} weight="fill" />}
        {modeLabel}
      </button>

      {/* Right-aligned health dot. Click → Health page. */}
      <Button
        variant="ghost"
        size="xs"
        onClick={() => navTo("#health")}
        title={healthTip}
        aria-label={healthTip}
        className="ml-auto text-[10px] font-normal text-muted-foreground hover:text-foreground"
      >
        <span className={cn("size-1.5 rounded-full shrink-0", SEVERITY_DOT[severity])} />
        <span>{isZh ? "健康" : "Health"}</span>
      </Button>
    </div>
  );
}
