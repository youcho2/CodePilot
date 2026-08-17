"use client";

/**
 * UsageCockpit — the "用量 / Usage" popover that sits to the RIGHT of the
 * per-session token stat (RunCockpit) in the composer action bar. It surfaces
 * account-level quota for the two subscription runtimes:
 *
 *   - **Codex**: live, on-demand. Fetches GET /api/codex/rate-limits on open
 *     (Codex app-server `account/rateLimits/read`). Reuses <CodexQuotaWidget>.
 *   - **Claude Code**: there is NO on-demand Claude usage source. The only
 *     signal is the transient `rate_limit_event` the Agent SDK emits DURING a
 *     streamed turn, and ONLY on claude.ai subscription paths (never API-key /
 *     third-party). We show that last-known snapshot (`streamSnapshot.
 *     rateLimitInfo`) and, when absent, an HONEST empty state — never a fake 0.
 *
 * This split is deliberate and documented: the panel must not imply Claude
 * usage is a live gauge when it isn't (反假数据). See docs handover.
 */

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChartBar, Warning } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import { CodexQuotaWidget } from "@/components/settings/CodexQuotaWidget";
import type { CodexRateLimitSnapshot } from "@/lib/codex/types";

/** Shape of `streamSnapshot.rateLimitInfo` (Claude subscription telemetry). */
export interface ClaudeRateLimitInfo {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;
  rateLimitType?:
    | "five_hour"
    | "seven_day"
    | "seven_day_opus"
    | "seven_day_sonnet"
    | "overage";
  /** 0..1 fraction, same scale the SDK reports and RateLimitBanner renders. */
  utilization?: number;
}

interface UsageCockpitProps {
  /** Last-known Claude rate-limit snapshot from the active session's stream. */
  claudeRateLimit?: ClaudeRateLimitInfo;
}

function claudeWindowLabel(
  type: ClaudeRateLimitInfo["rateLimitType"],
  isZh: boolean,
): string {
  switch (type) {
    case "five_hour":
      return isZh ? "5 小时窗口" : "5h window";
    case "seven_day":
      return isZh ? "7 天窗口" : "7d window";
    case "seven_day_opus":
      return isZh ? "7 天窗口 (Opus)" : "7d window (Opus)";
    case "seven_day_sonnet":
      return isZh ? "7 天窗口 (Sonnet)" : "7d window (Sonnet)";
    case "overage":
      return isZh ? "超额用量" : "Overage";
    default:
      return isZh ? "用量" : "Usage";
  }
}

function formatResetsAt(epochSec: number | undefined, isZh: boolean): string {
  if (!epochSec) return "";
  const diffMs = epochSec * 1000 - Date.now();
  if (diffMs <= 0) return isZh ? "已重置" : "Rolled over";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return isZh ? `${mins} 分钟后重置` : `Resets in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return isZh ? `${hrs} 小时后重置` : `Resets in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return isZh ? `${days} 天后重置` : `Resets in ${days}d`;
}

function tone(pct: number): { bar: string; pct: string } {
  if (pct >= 85)
    return { bar: "bg-status-error-foreground", pct: "text-status-error-foreground" };
  if (pct >= 60)
    return { bar: "bg-status-warning-foreground", pct: "text-status-warning-foreground" };
  return { bar: "bg-status-success-foreground", pct: "text-status-success-foreground" };
}

function ClaudeSection({
  info,
  isZh,
}: {
  info: ClaudeRateLimitInfo | undefined;
  isZh: boolean;
}) {
  const hasUtil = info?.utilization != null;
  const pct = hasUtil ? Math.max(0, Math.min(100, info!.utilization! * 100)) : 0;
  const t = tone(pct);
  const rejected = info?.status === "rejected";
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
        Claude Code
      </div>
      {hasUtil ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              {claudeWindowLabel(info!.rateLimitType, isZh)}
            </span>
            <span className={cn("font-mono font-medium", t.pct)}>
              {isZh ? `已用 ${pct.toFixed(0)}%` : `${pct.toFixed(0)}% used`}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={cn("h-full transition-all", t.bar)} style={{ width: `${pct}%` }} />
          </div>
          {info!.resetsAt && (
            <div className="text-[10px] text-muted-foreground">
              {formatResetsAt(info!.resetsAt, isZh)}
            </div>
          )}
          {rejected && (
            <div className="flex items-start gap-1.5 text-[11px] text-status-error-foreground">
              <Warning size={12} weight="fill" className="shrink-0 mt-0.5" />
              <span>{isZh ? "已触达配额上限" : "Rate limit reached"}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {isZh
            ? "仅订阅（claude.ai）会话在一次流式回复后可见；API Key / 第三方渠道不上报用量。"
            : "Only shown after a subscription (claude.ai) turn streams; API-key / third-party sessions don't report usage."}
        </p>
      )}
    </div>
  );
}

export function UsageCockpit({ claudeRateLimit }: UsageCockpitProps) {
  const { locale } = useTranslation();
  const isZh = locale === "zh";
  const [snapshot, setSnapshot] = useState<CodexRateLimitSnapshot | null>(null);
  const [codexState, setCodexState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const fetchCodex = useCallback(async () => {
    setCodexState("loading");
    try {
      const res = await fetch("/api/codex/rate-limits");
      const data = await res.json();
      setSnapshot(data.snapshot ?? null);
      setCodexState("done");
    } catch {
      setSnapshot(null);
      setCodexState("error");
    }
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      // Refresh Codex quota each time the popover opens — it's live server data.
      if (open) void fetchCodex();
    },
    [fetchCodex],
  );

  const label = isZh ? "用量" : "Usage";
  const codexEmpty =
    isZh
      ? "登录 Codex 账号后可见配额。"
      : "Sign in to Codex to see quota.";

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={label}
          title={label}
          className="h-7 gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors"
        >
          <ChartBar size={13} />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 overflow-hidden p-3">
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold">{label}</div>

          <ClaudeSection info={claudeRateLimit} isZh={isZh} />

          <div className="-mx-3 border-t border-border/50" />

          <div className="flex flex-col gap-2">
            <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
              Codex
            </div>
            {codexState === "loading" && (
              <p className="text-[11px] text-muted-foreground">
                {isZh ? "加载中…" : "Loading…"}
              </p>
            )}
            {codexState !== "loading" && snapshot ? (
              // CodexQuotaWidget renders its own "使用配额" block + bars.
              <CodexQuotaWidget snapshot={snapshot} isZh={isZh} />
            ) : (
              codexState !== "loading" && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {codexEmpty}
                </p>
              )
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
