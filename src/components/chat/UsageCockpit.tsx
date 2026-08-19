"use client";

/**
 * UsageCockpit — the "用量 / Usage" popover next to the per-session token
 * stat (RunCockpit) in the composer. It shows account-level SUBSCRIPTION
 * quota (session + weekly windows + remaining), keyed to the CURRENT
 * session's resolved runtime so it only ever surfaces the one provider
 * that actually applies:
 *
 *   - **Codex** (`codex_runtime`): live GET /api/codex/rate-limits
 *     (Codex app-server `account/rateLimits/read`). 5h + 7d windows.
 *   - **Claude Code** (`claude_code`): live GET /api/claude-usage — the
 *     SAME data the `/usage` slash command reads (internal
 *     /api/oauth/usage). Session (5h) + weekly (all-models / scoped)
 *     windows. Only claude.ai subscription sessions have a token; API-key
 *     / third-party get an honest `no-oauth` empty state, never a fake 0.
 *   - **CodePilot Runtime / other** (`codepilot_runtime`): no subscription
 *     quota concept → honest "not applicable" state.
 *
 * 反假数据: every window's used % / reset time comes from a live upstream
 * read. Upstream reports no absolute token counts, so "remaining" renders
 * as `100 − used`%, never "N tokens". Empty/error paths degrade to honest
 * copy rather than zeros.
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
import type { ClaudeUsageSnapshot, ClaudeUsageWindow, ClaudeUsageReason } from "@/lib/claude-usage";
import type { ChatRuntime } from "@/lib/chat-runtime-shared";

interface UsageCockpitProps {
  /** The session's resolved runtime — gates which provider's quota shows. */
  runtime: ChatRuntime;
  /** Current provider id. '' / 'env' == the claude.ai subscription path. */
  providerId?: string;
}

type FetchState = "idle" | "loading" | "done" | "error";

/** Which quota source, if any, applies to this session. */
type UsageKind = "claude" | "codex" | "none";

function usageKindFor(runtime: ChatRuntime, providerId: string | undefined): UsageKind {
  if (runtime === "codex_runtime") return "codex";
  // Claude subscription usage only applies to the env/'' (claude.ai) path.
  // A third-party provider under claude_code auths with its own API key, so
  // the claude.ai account quota would be misleading there → show none.
  if (runtime === "claude_code" && (providerId === undefined || providerId === "" || providerId === "env")) {
    return "claude";
  }
  return "none";
}

function formatResetsFromIso(iso: string | undefined, isZh: boolean): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffMs = t - Date.now();
  if (diffMs <= 0) return isZh ? "已重置" : "Rolled over";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return isZh ? `${mins} 分钟后重置` : `Resets in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return isZh ? `${hrs} 小时后重置` : `Resets in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return isZh ? `${days} 天后重置` : `Resets in ${days}d`;
}

function tone(usedPercent: number): { bar: string; pct: string } {
  if (usedPercent >= 85)
    return { bar: "bg-status-error-foreground", pct: "text-status-error-foreground" };
  if (usedPercent >= 60)
    return { bar: "bg-status-warning-foreground", pct: "text-status-warning-foreground" };
  return { bar: "bg-status-success-foreground", pct: "text-status-success-foreground" };
}

function claudeWindowLabel(w: ClaudeUsageWindow, isZh: boolean): string {
  switch (w.kind) {
    case "session":
      return isZh ? "本会话 · 5 小时" : "Current session · 5h";
    case "weekly_all":
      return isZh ? "本周 · 全部模型" : "This week · all models";
    case "weekly_scoped":
      return w.scopeModel
        ? isZh
          ? `本周 · ${w.scopeModel}`
          : `This week · ${w.scopeModel}`
        : isZh
          ? "本周 · 限定模型"
          : "This week · scoped";
    default:
      return w.scopeModel ?? w.kind;
  }
}

function ClaudeWindowRow({ window, isZh }: { window: ClaudeUsageWindow; isZh: boolean }) {
  const pct = Math.max(0, Math.min(100, window.usedPercent));
  const remaining = Math.round(100 - pct);
  const t = tone(pct);
  const reset = formatResetsFromIso(window.resetsAt, isZh);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{claudeWindowLabel(window, isZh)}</span>
        <span className={cn("font-mono font-medium", t.pct)}>
          {isZh ? `已用 ${pct.toFixed(0)}%` : `${pct.toFixed(0)}% used`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full transition-all", t.bar)} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground">
        {isZh ? `剩余 ${remaining}%` : `${remaining}% left`}
        {reset ? ` · ${reset}` : ""}
      </div>
    </div>
  );
}

function claudeEmptyCopy(reason: ClaudeUsageReason | undefined, isZh: boolean): string {
  switch (reason) {
    case "no-oauth":
      return isZh
        ? "当前会话不是 claude.ai 订阅登录（API Key / 第三方渠道无订阅额度）。"
        : "This session isn't a claude.ai subscription login (API-key / third-party has no quota).";
    case "expired":
      return isZh
        ? "Claude 登录已过期，请在应用内重新登录后再查看。"
        : "Claude login expired — sign in again to see usage.";
    default:
      return isZh ? "暂时无法获取用量，请稍后重试。" : "Couldn't load usage — try again shortly.";
  }
}

export function UsageCockpit({ runtime, providerId }: UsageCockpitProps) {
  const { locale } = useTranslation();
  const isZh = locale === "zh";
  const kind = usageKindFor(runtime, providerId);

  const [codexSnap, setCodexSnap] = useState<CodexRateLimitSnapshot | null>(null);
  const [claudeSnap, setClaudeSnap] = useState<ClaudeUsageSnapshot | null>(null);
  const [claudeReason, setClaudeReason] = useState<ClaudeUsageReason | undefined>(undefined);
  const [state, setState] = useState<FetchState>("idle");

  const fetchCodex = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/codex/rate-limits");
      const data = await res.json();
      setCodexSnap(data.snapshot ?? null);
      setState("done");
    } catch {
      setCodexSnap(null);
      setState("error");
    }
  }, []);

  const fetchClaude = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/claude-usage");
      const data = await res.json();
      setClaudeSnap(data.snapshot ?? null);
      setClaudeReason(data.reason ?? undefined);
      setState("done");
    } catch {
      setClaudeSnap(null);
      setClaudeReason("unavailable");
      setState("error");
    }
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      if (kind === "codex") void fetchCodex();
      else if (kind === "claude") void fetchClaude();
    },
    [kind, fetchCodex, fetchClaude],
  );

  const label = isZh ? "用量" : "Usage";

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

          {state === "loading" && (
            <p className="text-[11px] text-muted-foreground">{isZh ? "加载中…" : "Loading…"}</p>
          )}

          {state !== "loading" && kind === "claude" && (
            <div className="flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Claude Code
              </div>
              {claudeSnap && claudeSnap.windows.length > 0 ? (
                claudeSnap.windows.map((w, i) => (
                  <ClaudeWindowRow key={`${w.kind}-${w.scopeModel ?? i}`} window={w} isZh={isZh} />
                ))
              ) : (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {claudeEmptyCopy(claudeReason, isZh)}
                </p>
              )}
            </div>
          )}

          {state !== "loading" && kind === "codex" && (
            <div className="flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Codex
              </div>
              {codexSnap ? (
                <CodexQuotaWidget snapshot={codexSnap} isZh={isZh} />
              ) : (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {isZh ? "登录 Codex 账号后可见配额。" : "Sign in to Codex to see quota."}
                </p>
              )}
            </div>
          )}

          {kind === "none" && (
            <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Warning size={12} className="shrink-0 mt-0.5" />
              <span>
                {isZh
                  ? "当前 Runtime 使用自有 API Key，无订阅用量额度。"
                  : "This runtime uses your own API keys — no subscription quota."}
              </span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
