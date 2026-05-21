'use client';

import { useMemo } from 'react';
import { MonolithIcon } from '@/components/brand/MonolithIcon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

/**
 * NewChatWelcome — centered hero shown above the composer on the new-chat
 * page (when no session exists or no messages have been sent yet).
 *
 * Layout (mirrors the ChatGPT / Claude / Codex new-chat pattern):
 *
 *     [Monolith logo]
 *     [Random welcome message]
 *
 * The welcome line rotates across 6 short prompts. We pick a stable
 * index for the lifetime of the component (via useMemo with no deps)
 * so the message doesn't flicker on re-render but DOES change every
 * time the user opens /chat fresh (new mount → new random pick).
 *
 * The logo + text stack is centered horizontally; the parent is
 * responsible for the vertical centering against the composer below it.
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
    <div className="flex flex-col items-center text-center gap-3 mb-6">
      <MonolithIcon className="h-12 w-12" />
      <h1 className="text-2xl font-medium tracking-tight text-foreground">
        {t(welcomeKey)}
      </h1>
    </div>
  );
}
