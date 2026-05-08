"use client";

/**
 * Per-chat run status — bottom-right of the chat composer.
 *
 * Aprl 2026 unification (Codex review): replaces the previous cluster
 * of three separate chips (Runtime / Pinned / Health) plus a stand-
 * alone ContextUsageIndicator. All five concerns now feed into one
 * Popover:
 *   • Trigger row: a compact text summary of the current run (engine ·
 *     pinned-or-auto · context). Reads as a status sentence, not a
 *     toolbar.
 *   • Panel: a read-only `RunStatusPanel` listing engine / model /
 *     default / permission / context, with quiet "→ 设置" links per row
 *     plus a flagged "需要处理" section for blocking issues.
 *
 * The panel never writes state — every action redirects to the
 * canonical Settings pages. Severity is derived the same way the
 * Settings → Health page rolls it up, so the two surfaces never
 * disagree.
 */

import { useMemo } from "react";
import type { LanguageModelUsage } from "ai";
import type { Message } from "@/types";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { useClaudeStatus } from "@/hooks/useClaudeStatus";
import { useContextUsage } from "@/hooks/useContextUsage";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Warning, ArrowSquareOut } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  computeEffectiveRuntime,
  type AgentRuntime,
} from "@/lib/runtime/effective";
import { useOverviewData } from "@/components/settings/useOverviewData";
import {
  Context,
  ContextContentHeader,
  ContextContentBody,
  ContextContentFooter,
  ContextInputUsage,
  ContextOutputUsage,
  ContextCacheUsage,
} from "@/components/ai-elements/context";

interface RunStatusIssue {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

type Severity = "ok" | "warn" | "error";

function navTo(hash: string) {
  if (typeof window !== "undefined") {
    window.location.href = `/settings${hash}`;
  }
}

function formatTokensCompact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return String(n);
}

// Compact context-usage ring — visually mirrors the SVG inside
// `ai-elements/context.tsx#ContextIcon` so the trigger here matches
// what the Vercel elements lib renders. We inline it instead of using
// `<ContextTrigger />` because that component is a HoverCard trigger
// and we want click-to-open via Popover, not hover-only.
function RingIcon({ percent }: { percent: number }) {
  const RADIUS = 10;
  const STROKE = 2;
  const VBOX = 24;
  const CENTER = 12;
  const circumference = 2 * Math.PI * RADIUS;
  const usedPercent = Math.min(1, Math.max(0, percent));
  const dashOffset = circumference * (1 - usedPercent);
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox={`0 0 ${VBOX} ${VBOX}`}
      style={{ color: "currentcolor" }}
    >
      <circle cx={CENTER} cy={CENTER} fill="none" opacity="0.25" r={RADIUS}
        stroke="currentColor" strokeWidth={STROKE} />
      <circle cx={CENTER} cy={CENTER} fill="none" opacity="0.7" r={RADIUS}
        stroke="currentColor" strokeWidth={STROKE}
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }} />
    </svg>
  );
}

interface RunCockpitProps {
  /** Active chat's provider — drives session-level runtime overrides
   *  (OpenAI OAuth → forced Native). */
  providerId?: string;
  /** Chat messages, for context-usage calculation. Pass `[]` on the
   *  first-message page (before any assistant turn). */
  messages?: Message[];
  /** Currently selected model name. */
  modelName?: string;
  /** Whether `context-1m-2025-08-07` is enabled for this chat. */
  context1m?: boolean;
  /** Whether a session summary (compaction) is active. */
  hasSummary?: boolean;
  /** Resolved upstream model ID for accurate context-window lookup. */
  upstreamModelId?: string;
  /** SDK-authoritative usage snapshot (Phase 5). */
  contextUsageSnapshot?: {
    totalTokens: number;
    maxTokens: number;
    capturedAt: number;
  };
  /** Active chat's permission profile. */
  permissionProfile?: "default" | "full_access";
  /** Pre-send token estimate for currently attached @ mention chips.
   *  Surfaced as a "+10K 待加" suffix in the status row + panel context
   *  cell so the user can preview the cost. Resets to 0 after send. */
  pendingContextTokens?: number;
  /** Phase 2 Step 4c round 4 — session-level runtime pin from the
   *  composer's RuntimeSelector. When non-empty, this cockpit must
   *  PREFER session signals over the global default: the runtime label
   *  reflects the user's pick (not `state.agentRuntime`), and the
   *  global "固定不可用" / "执行引擎已降级" signals are suppressed
   *  because they describe the global pin the user has explicitly
   *  overridden for this session. Without this prop, the chip kept
   *  displaying red "Claude Code · 固定不可用" even after the upper
   *  RunCheckpoint had cleared — same surface, contradictory signals.
   *  Empty / undefined → fall back to the existing global-default
   *  rendering (no behavior change for sessions following global). */
  sessionRuntimePin?: string;
}

export function RunCockpit({
  providerId,
  messages = [],
  modelName = "",
  context1m,
  hasSummary,
  upstreamModelId,
  contextUsageSnapshot,
  permissionProfile = "default",
  pendingContextTokens = 0,
  sessionRuntimePin,
}: RunCockpitProps = {}) {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "对话";
  const state = useOverviewData();
  const { status: claudeStatus } = useClaudeStatus();
  const usage = useContextUsage(messages, modelName, {
    context1m,
    hasSummary,
    upstreamModelId,
    snapshot: contextUsageSnapshot,
  });

  const cliConnected = !!claudeStatus?.connected;
  const settingRuntime: AgentRuntime = computeEffectiveRuntime(
    state.agentRuntime,
    state.cliEnabled,
    cliConnected,
  );
  const isNonAnthropicProvider = providerId === "openai-oauth";
  // Step 4c round 4 — session-level runtime override. When the user
  // has explicitly pinned a runtime via the composer's RuntimeSelector,
  // this cockpit must reflect THAT runtime, not the global setting.
  // Map the chat-runtime label to the agent-runtime form used here.
  const sessionRuntimeOverride = !!sessionRuntimePin;
  const sessionPinnedAgentRuntime: AgentRuntime | null =
    sessionRuntimePin === "claude_code"
      ? "claude-code-sdk"
      : sessionRuntimePin === "codepilot_runtime"
        ? "native"
        : null;
  const effectiveRuntime: AgentRuntime = isNonAnthropicProvider
    ? "native"
    : sessionPinnedAgentRuntime ?? settingRuntime;
  // Global SDK→native fallback notice: only meaningful when the user is
  // following the global runtime. Under explicit pin, the user has
  // already moved off Claude Code (or is happily on it via override) —
  // the global fallback narrative no longer describes their session.
  // Round 5 — kept only for `severity` (so the chip turns warning when
  // the global fallback fires); the chip's text no longer says "执行
  // 引擎已降级" because the upper RunCheckpoint already explains it.
  const runtimeFallback =
    !sessionRuntimeOverride &&
    state.agentRuntime === "claude-code-sdk" &&
    effectiveRuntime !== "claude-code-sdk";
  // Same shape for the global pinned-default-invalid signal. Used only
  // by `severity` for the same reason as `runtimeFallback`.
  const showGlobalDefaultInvalid = !sessionRuntimeOverride && state.defaultInvalid;

  const severity: Severity = useMemo(() => {
    if (state.loading) return "ok";
    if (state.providersConfigured === 0) return "error";
    if (state.modelsEnabled === 0) return "error";
    if (state.noCompatibleProvider) return "error";
    if (showGlobalDefaultInvalid) return "error";
    if (runtimeFallback) return "error";
    const claudeWarn = !!(claudeStatus?.warnings && claudeStatus.warnings.length > 0);
    if (claudeWarn) return "warn";
    if (state.agentRuntime === "claude-code-sdk" && !state.cliEnabled) return "warn";
    if (!state.workspaceConfigured) return "warn";
    return "ok";
  }, [state, claudeStatus, runtimeFallback, showGlobalDefaultInvalid]);

  // While Overview / Health data is in flight, render a disabled
  // placeholder instead of returning null. Empty whitespace mid-bar
  // looks broken; an explicit "loading" string explains the brief
  // async window.
  if (state.loading) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled
        className="h-7 rounded-md px-2 text-[11px] font-medium text-muted-foreground/70"
      >
        {t("runStatus.loading" as TranslationKey)}
      </Button>
    );
  }

  // Step 4c round 5 (revised) — drop the runtime label from this
  // surface. The composer's RuntimeSelector already shows the active
  // engine; duplicating it here was the redundancy users called out.
  // Pinned-mode and runtime-fallback TEXT are also gone (they live in
  // the upper RunCheckpoint now). What's RESTORED relative to the
  // first round-5 attempt: click-triggered Popover (was hover-only via
  // HoverCard — that broke the click affordance), and the Model /
  // Permission summary rows in the popover content (the previous pass
  // dropped them and the panel felt empty).
  const lmUsage: LanguageModelUsage | undefined = usage.hasData
    ? {
        inputTokens: Math.max(0, usage.used - usage.cacheReadTokens - usage.cacheCreationTokens),
        inputTokenDetails: {
          noCacheTokens: Math.max(0, usage.used - usage.cacheReadTokens - usage.cacheCreationTokens),
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheCreationTokens,
        },
        outputTokens: usage.outputTokens,
        outputTokenDetails: { textTokens: usage.outputTokens, reasoningTokens: undefined },
        totalTokens: usage.used + usage.outputTokens,
        cachedInputTokens: usage.cacheReadTokens,
      }
    : undefined;

  // Issues — providers / models / Claude CLI warnings that don't reach
  // the upper RunCheckpoint. Surface them here (in the popover) so the
  // user can still get to a fix without leaving the chat.
  const issues: RunStatusIssue[] = [];
  if (state.providersConfigured === 0) {
    issues.push({
      message: isZh ? "尚未配置任何服务商" : "No providers configured",
      actionLabel: t("runStatus.fixIssue" as TranslationKey),
      onAction: () => navTo("#providers"),
    });
  }
  if (state.modelsEnabled === 0 && state.providersConfigured > 0) {
    issues.push({
      message: isZh ? "未启用任何模型" : "No models enabled",
      actionLabel: t("runStatus.fixIssue" as TranslationKey),
      onAction: () => navTo("#models"),
    });
  }
  if (state.noCompatibleProvider) {
    issues.push({
      message: isZh
        ? "当前执行引擎下没有可用的服务商"
        : "No compatible provider under the current Runtime",
      actionLabel: t("runStatus.fixIssue" as TranslationKey),
      onAction: () => navTo("#runtime"),
    });
  }
  if (claudeStatus?.warnings && claudeStatus.warnings.length > 0) {
    for (const w of claudeStatus.warnings) {
      issues.push({ message: w });
    }
  }

  const showIssuesBadge = severity !== "ok";
  const triggerClass = cn(
    "h-7 gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
    severity === "ok"
      ? "text-muted-foreground"
      : severity === "warn"
        ? "text-status-warning-foreground hover:text-status-warning-foreground"
        : "text-status-error-foreground hover:text-status-error-foreground",
  );

  // Pending-tokens suffix surfaces the @ mention chip cost preview.
  const pendingSuffix = pendingContextTokens > 0
    ? ` +${formatTokensCompact(pendingContextTokens)}`
    : '';

  const hasFullCtx = usage.hasData && (usage.contextWindow ?? 0) > 0;
  // Pinned-default chip text — when this session follows the global
  // runtime AND the global is in pinned mode, surface the pinned/
  // pinned-invalid status alongside the context %, like the original
  // chip did. Suppressed under sessionRuntimeOverride (the user opted
  // out of the global default for this session, so its pinned-vs-auto
  // disposition no longer applies).
  const modeIsPinned = state.defaultMode === "pinned";
  const pinnedChipText: string | null =
    !sessionRuntimeOverride && modeIsPinned
      ? showGlobalDefaultInvalid
        ? t("runStatus.modePinnedInvalid" as TranslationKey)
        : t("runStatus.modePinned" as TranslationKey)
      : null;

  // Trigger label — restore the "其他信息 (除引擎外)" the user asked
  // for: a Context-style ring + percentage when we have full data
  // (or just the ring placeholder + token count when capacity is
  // unknown), the pinned chip when relevant, and the warning glyph
  // for unresolved issues. The runtime label is intentionally absent
  // — RuntimeSelector to the left already carries it.
  const ringPercent = hasFullCtx ? Math.min(1, Math.max(0, usage.ratio)) : 0;
  const ratioText = hasFullCtx
    ? `${(usage.ratio * 100).toFixed(usage.ratio < 0.1 ? 1 : 0)}%${pendingSuffix}`
    : usage.hasData
      ? `${formatTokensCompact(usage.used)}${pendingSuffix}`
      : pendingContextTokens > 0
        ? `+${formatTokensCompact(pendingContextTokens)}`
        : "—";

  // Reusable trigger button — Context-style ring icon (mirrors the
  // SVG in `ai-elements/context.tsx#ContextIcon`) + percentage +
  // pinned chip + warning. Same shape regardless of which render path
  // takes over below.
  const triggerButton = (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-label={t("runStatus.triggerLabel" as TranslationKey)}
      className={triggerClass}
    >
      {showIssuesBadge && <Warning size={11} weight="fill" />}
      <RingIcon percent={ringPercent} />
      <span className="truncate">{ratioText}</span>
      {pinnedChipText && (
        <span className="text-[10px] text-muted-foreground/70">· {pinnedChipText}</span>
      )}
    </Button>
  );

  // Auxiliary rows in the popover — restored from the original Run
  // Status panel, minus the Runtime row (RuntimeSelector to the left
  // already shows the active engine; the user's instruction was to
  // drop the duplicate, NOT the Model / DefaultMode / Permission rows).
  //
  // 2026-05-08 fix: the "模型" row now reflects THIS session's actual
  // selection (`providerId` + `modelName` props), not the global
  // default. The previous wiring read `state.defaultProviderName /
  // defaultModelLabel`, so users who switched runtime / model in the
  // composer saw e.g. "GPT-5.4" in the trigger but "GLM (CN) ·
  // glm-5-turbo" (the global default) in the popover — directly
  // contradictory. Global default is intentionally NOT shown here; it
  // belongs to Settings → Runtime / Models, and the upper RunCheckpoint
  // already surfaces "pinned default invalid" when relevant.
  // Resolve session provider/model labels from the unfiltered groups
  // already cached by `useOverviewData`. Fall back to the raw id/value
  // when the lookup misses (mid-fetch, or a saved provider that's been
  // deleted). Empty providerId / modelName → "未配置" so an unfilled
  // session reads coherently rather than as "undefined · undefined".
  const sessionProviderGroup = providerId
    ? state.providers.find((g) => g.provider_id === providerId)
    : undefined;
  const sessionModelEntry = sessionProviderGroup && modelName
    ? sessionProviderGroup.models.find((m) => m.value === modelName)
    : undefined;
  const providerLabel = sessionProviderGroup?.provider_name
    ?? (providerId || t("runStatus.notConfigured" as TranslationKey));
  const modelLabel = sessionModelEntry?.label
    ?? (modelName || t("runStatus.notConfigured" as TranslationKey));
  const defaultModeValue = sessionRuntimeOverride
    // Under override the session no longer follows the global default
    // mode — round-2 in chat/page.tsx switched the resolver to 'auto'
    // for that case, so display matches the actual behaviour.
    ? t("runStatus.modeAuto" as TranslationKey)
    : modeIsPinned
      ? showGlobalDefaultInvalid
        ? t("runStatus.modePinnedInvalid" as TranslationKey)
        : t("runStatus.modePinned" as TranslationKey)
      : t("runStatus.modeAuto" as TranslationKey);
  const auxRows = (
    <div className="flex flex-col gap-2 p-3 text-xs">
      <div className="text-sm font-medium text-foreground">
        {t("runStatus.title" as TranslationKey)}
      </div>
      <div className="group/row flex items-baseline gap-3">
        <span className="shrink-0 text-muted-foreground">
          {t("runStatus.model" as TranslationKey)}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-foreground">
          {`${providerLabel} · ${modelLabel}`}
        </span>
        <button
          type="button"
          onClick={() => navTo("#models")}
          className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/40 transition-colors group-hover/row:text-muted-foreground hover:!text-foreground"
        >
          {t("runStatus.switch" as TranslationKey)}
          <ArrowSquareOut size={10} />
        </button>
      </div>
      <div className="group/row flex items-baseline gap-3">
        <span className="shrink-0 text-muted-foreground">
          {t("runStatus.defaultMode" as TranslationKey)}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-right",
            !sessionRuntimeOverride && showGlobalDefaultInvalid
              ? "text-status-warning-foreground"
              : "text-foreground",
          )}
        >
          {defaultModeValue}
        </span>
        <button
          type="button"
          onClick={() => navTo("#models")}
          className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/40 transition-colors group-hover/row:text-muted-foreground hover:!text-foreground"
        >
          {t("runStatus.modify" as TranslationKey)}
          <ArrowSquareOut size={10} />
        </button>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="shrink-0 text-muted-foreground">
          {t("runStatus.permission" as TranslationKey)}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-right",
            permissionProfile === "full_access"
              ? "text-status-error-foreground"
              : "text-foreground",
          )}
        >
          {permissionProfile === "full_access"
            ? t("runStatus.permissionFullAccess" as TranslationKey)
            : t("runStatus.permissionDefault" as TranslationKey)}
        </span>
      </div>
    </div>
  );

  // Issues block — same shape used in both render paths.
  const issuesBlock = issues.length > 0 ? (
    <div className="flex flex-col gap-2 p-3">
      <div className="text-xs font-medium text-status-warning-foreground">
        {t("runStatus.issuesHeader" as TranslationKey)}
      </div>
      <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {issues.map((issue, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className="mt-1 size-1 shrink-0 rounded-full bg-status-warning-foreground" />
            <div className="flex-1 leading-snug">
              <span>{issue.message}</span>
              {issue.actionLabel && issue.onAction && (
                <button
                  type="button"
                  onClick={issue.onAction}
                  className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {issue.actionLabel}
                  <ArrowSquareOut size={10} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  // Full-context path: wrap the Popover in `<Context>` so the
  // ContextContentHeader / Body breakdowns / Footer can all read from
  // the ContextContext provider. The HoverCard that `<Context>` renders
  // internally stays inert because we don't include any HoverCardTrigger
  // — only the inner Popover handles open/close, which gives users
  // back the **click-to-open** behaviour the previous round-5 pass
  // accidentally regressed to hover-only.
  if (hasFullCtx) {
    return (
      <Context
        usedTokens={usage.used}
        maxTokens={usage.contextWindow!}
        usage={lmUsage}
        modelId={upstreamModelId ?? modelName}
      >
        <Popover>
          <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            className="w-80 divide-y overflow-hidden p-0"
          >
            <ContextContentHeader />
            <ContextContentBody className="p-3 space-y-1.5">
              <ContextInputUsage />
              <ContextOutputUsage />
              <ContextCacheUsage />
            </ContextContentBody>
            {auxRows}
            {issuesBlock}
            <ContextContentFooter />
          </PopoverContent>
        </Popover>
      </Context>
    );
  }

  // Fallback path — either (a) no usage data yet (pre-first-response)
  // or (b) we have usage but `contextWindow` couldn't be resolved for
  // this model (e.g. glm-5-turbo's window is unknown to
  // model-context.ts).
  //
  // 2026-05-08 fix: case (b) used to drop the entire Context block,
  // leaving only Model / 默认 / 权限 in the popover even though we had
  // valid input / output / cache numbers from the assistant turn. Now
  // we render an inline used / input / output / cache breakdown with
  // a "容量未知" label in place of the percentage. Mirrors the old
  // ContextUsageIndicator's "capacity unknown" branch — the user
  // still gets to see what the turn actually consumed; only the
  // percent and progress bar disappear because they have no denominator.
  const showUnknownCapacityBlock = usage.hasData && !hasFullCtx;
  const usedDisplay = formatTokensCompact(usage.used);
  const outputDisplay = formatTokensCompact(usage.outputTokens);
  const cacheReadDisplay = formatTokensCompact(usage.cacheReadTokens);
  const cacheCreationDisplay = formatTokensCompact(usage.cacheCreationTokens);
  const inputOnly = Math.max(0, usage.used - usage.cacheReadTokens - usage.cacheCreationTokens);
  const inputDisplay = formatTokensCompact(inputOnly);
  return (
    <Popover>
      <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 divide-y overflow-hidden p-0"
      >
        {showUnknownCapacityBlock && (
          <>
            <div className="w-full space-y-1 p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <p className="text-muted-foreground">
                  {t("runStatus.contextCapacityUnknown" as TranslationKey)}
                </p>
                <p className="font-mono text-foreground">
                  {`${usedDisplay}${pendingSuffix}`}
                </p>
              </div>
            </div>
            <div className="p-3 space-y-1.5 text-xs">
              {inputOnly > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {t("runStatus.contextInput" as TranslationKey)}
                  </span>
                  <span className="font-mono">{inputDisplay}</span>
                </div>
              )}
              {usage.outputTokens > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {t("runStatus.contextOutput" as TranslationKey)}
                  </span>
                  <span className="font-mono">{outputDisplay}</span>
                </div>
              )}
              {(usage.cacheReadTokens > 0 || usage.cacheCreationTokens > 0) && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {t("runStatus.contextCache" as TranslationKey)}
                  </span>
                  <span className="font-mono">
                    {usage.cacheCreationTokens > 0 && usage.cacheReadTokens > 0
                      ? `${cacheReadDisplay} / +${cacheCreationDisplay}`
                      : usage.cacheReadTokens > 0
                        ? cacheReadDisplay
                        : `+${cacheCreationDisplay}`}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
        {auxRows}
        {issuesBlock}
      </PopoverContent>
    </Popover>
  );
}
