'use client';

import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Brain, CaretDown, CheckCircle } from '@/components/ui/icon';
import type { ChatRuntime } from '@/lib/chat-runtime-shared';

interface RuntimeSelectorProps {
  // The session's persisted `runtime_pin`. Empty string means the session
  // is following the global default (new sessions, or sessions whose
  // runtime hasn't been seeded yet by the chat route).
  runtimePin: string;
  // The currently effective runtime label — what would actually run if
  // the user pressed send right now. Used to render the trigger label
  // when `runtimePin === ''` so the user sees a concrete name instead
  // of a "follow default" hedge that doesn't tell them what's happening.
  effectiveRuntime: ChatRuntime;
  // Called with the new pin value. New chat (no sessionId yet) → caller
  // updates local state only. Existing session → caller PATCHes
  // `/api/chat/sessions/{id}` with `{ runtime_pin }`.
  onRuntimePinChange: (pin: ChatRuntime) => void;
  // Streaming guard: changing runtime mid-flight would either silently
  // fall through to the next message (confusing) or kill the active
  // stream (worse). Match ModeIndicator/ChatPermissionSelector — both
  // disable during stream.
  disabled?: boolean;
}

// Composer toolbar select for the session-level execution runtime.
// Visual language matches ModeIndicator + ChatPermissionSelector — invisible
// ghost button at default weight, hover surfaces the accent. The icon and
// label do the disambiguation; no colour cue.
//
// Phase 2 Step 4c places this between ModeIndicator and ChatPermissionSelector
// in the composer left toolbar (per user direction). Two options today:
// Claude Code, CodePilot Runtime. "Follow default" is not a separate option
// — it's the absence of a pin, which the chat route's lazy-seed turns into
// a concrete pin on first send anyway.
export function RuntimeSelector({
  runtimePin,
  effectiveRuntime,
  onRuntimePinChange,
  disabled,
}: RuntimeSelectorProps) {
  const { t } = useTranslation();

  // The label always reflects what would actually run. We previously
  // appended a "本会话已切换" sub-badge whenever `runtimePin` was non-
  // empty, but Step 4c round-5 user feedback dropped it: if the user
  // just clicked this select themselves, telling them they switched
  // is redundant; mid-conversation switches will get a proper inline
  // marker via the AI-elements Checkpoint component (separate slice).
  const activeRuntime: ChatRuntime = runtimePin === 'claude_code' || runtimePin === 'codepilot_runtime'
    ? runtimePin
    : effectiveRuntime;
  const label = activeRuntime === 'codepilot_runtime'
    ? t('runtimeSelector.codepilotRuntime' as TranslationKey)
    : t('runtimeSelector.claudeCode' as TranslationKey);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          data-runtime-selector
          aria-label={t('runtimeSelector.triggerAria' as TranslationKey)}
          className={cn(
            'h-7 rounded-md text-xs font-normal text-muted-foreground',
          )}
        >
          <Brain size={12} />
          <span>{label}</span>
          <CaretDown size={10} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        <DropdownMenuItem
          onClick={() => onRuntimePinChange('claude_code')}
          className="items-start py-2"
        >
          <Brain size={14} className="mt-0.5" />
          <div className="flex flex-col items-start gap-0.5 flex-1">
            <span className="flex items-center gap-1.5">
              {t('runtimeSelector.claudeCode' as TranslationKey)}
              {activeRuntime === 'claude_code' && (
                <CheckCircle size={12} className="text-status-success-foreground" />
              )}
            </span>
            <span className="text-[11px] text-muted-foreground leading-tight">
              {t('runtimeSelector.claudeCodeDesc' as TranslationKey)}
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onRuntimePinChange('codepilot_runtime')}
          className="items-start py-2"
        >
          <Brain size={14} className="mt-0.5" />
          <div className="flex flex-col items-start gap-0.5 flex-1">
            <span className="flex items-center gap-1.5">
              {t('runtimeSelector.codepilotRuntime' as TranslationKey)}
              {activeRuntime === 'codepilot_runtime' && (
                <CheckCircle size={12} className="text-status-success-foreground" />
              )}
            </span>
            <span className="text-[11px] text-muted-foreground leading-tight">
              {t('runtimeSelector.codepilotRuntimeDesc' as TranslationKey)}
            </span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
