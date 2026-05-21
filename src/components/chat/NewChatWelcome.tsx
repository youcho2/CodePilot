'use client';

import { useMemo } from 'react';
import { MonolithIcon } from '@/components/brand/MonolithIcon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

/**
 * NewChatWelcome — single-line hero shown directly above the composer
 * on the new-chat page (when no session exists or no messages have
 * been sent yet).
 *
 * Layout (mirrors the ChatGPT / Claude / Codex new-chat pattern):
 *
 *     [Monolith logo] [Random welcome message in large text]
 *
 * Logo + text live on ONE row, vertically aligned with each other.
 * Logo height tracks the text's cap height so the two read as a
 * single composed wordmark, not as a stack. The parent
 * (`/chat/page.tsx`) is responsible for vertically centering this
 * row + composer + cards as one block against the viewport.
 *
 * The welcome line rotates across 6 short prompts. We pick a stable
 * index for the lifetime of the component (via useMemo with no deps)
 * so the message doesn't flicker on re-render but DOES change every
 * time the user opens /chat fresh (new mount → new random pick).
 */

const WELCOME_KEYS: ReadonlyArray<TranslationKey> = [
  'chat.newChat.welcome.1' as TranslationKey,
  'chat.newChat.welcome.2' as TranslationKey,
  'chat.newChat.welcome.3' as TranslationKey,
  'chat.newChat.welcome.4' as TranslationKey,
  'chat.newChat.welcome.5' as TranslationKey,
  'chat.newChat.welcome.6' as TranslationKey,
];

export function NewChatWelcome() {
  const { t } = useTranslation();
  const welcomeKey = useMemo(
    () => WELCOME_KEYS[Math.floor(Math.random() * WELCOME_KEYS.length)],
    [],
  );

  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      <MonolithIcon className="h-9 w-9 shrink-0" />
      <h1 className="text-3xl font-medium tracking-tight text-foreground leading-none">
        {t(welcomeKey)}
      </h1>
    </div>
  );
}
