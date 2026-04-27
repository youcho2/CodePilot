"use client";

/**
 * Settings → Runtime — Phase 2B home for Runtime Trust.
 *
 * Three-layer mental model the user should walk away with:
 *   - Providers (assets) — what services / credentials you own
 *   - Models    (exposure) — which models reach the chat picker
 *   - Runtime   (this surface) — who actually runs the Agent right now,
 *     why, what's its impact, how to recover
 *
 * Phase 2B.1 (this commit) lands the navigation entry + page shell only.
 * Subsequent tasks fill it in:
 *
 *   2B.2 — RuntimeState five-state model (extend `isAvailable` → `getState`)
 *   2B.3 — Claude Code Runtime status card (CLI / login / settings.json /
 *          current session selection — with reason / impact / recovery)
 *   2B.4 — CodePilot Runtime status card (Capabilities / Permissions /
 *          Context — medium granularity, three buckets)
 *   2B.5 — Session-level read-only explainer (default runtime + reason +
 *          provider/model + degradation path)
 *   2B.6 — `session_events.runtime.selected` minimal write
 *   2B.7 — Trim Setup Center / CliSettingsSection so Runtime is the
 *          single home for runtime explanation
 *
 * See `docs/exec-plans/active/agent-trust-ownership-refactor.md`
 * §"Phase 2B：Runtime Trust" for the full scope + 4 confirmed decisions.
 */

import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

export function RuntimePanel() {
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-sm font-medium">
          {t('settings.runtime' as TranslationKey)}
        </h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {isZh
            ? '查看当前 Agent 由谁运行、为什么是这个状态、影响是什么、怎么恢复。Providers 管资产，Models 管暴露，Runtime 管运行环境。'
            : 'Inspect which runtime is currently in charge of the Agent — why it\'s in this state, what its impact is, and how to recover. Providers govern assets, Models govern exposure, Runtime governs environment.'}
        </p>
      </div>

      {/* Phase 2B.1: skeleton — empty placeholder.
          Populated by 2B.3 / 2B.4 with two parallel runtime cards. */}
      <div className="rounded-lg border border-dashed border-border/50 bg-card/50 p-10 flex flex-col items-center text-center gap-2">
        <div className="text-sm font-medium text-muted-foreground">
          {isZh ? 'Runtime 状态面板（即将到来）' : 'Runtime status panels (coming soon)'}
        </div>
        <div className="text-xs text-muted-foreground/80 max-w-md">
          {isZh
            ? '本面板将平级展示 Claude Code Runtime 与 CodePilot Runtime — 当前状态、为什么是这个状态、影响、恢复路径，以及当前默认会话会用哪个 provider / model。'
            : 'This panel will show Claude Code Runtime and CodePilot Runtime in parallel — current state, why, impact, recovery, and which provider/model the default session will run through.'}
        </div>
      </div>
    </div>
  );
}
