'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { X } from '@/components/ui/icon';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';
import { EGG_IMAGE_URL } from '@/lib/buddy';

interface ChatEmptyStateProps {
  hasDirectory: boolean;
  hasProvider: boolean;
  onSelectFolder: () => void;
  recentProjects?: string[];
  onSelectProject?: (path: string) => void;
  assistantConfigured?: boolean;
  onOpenAssistant?: () => void;
}

export function ChatEmptyState({
  hasDirectory,
  hasProvider,
  onSelectFolder,
  recentProjects,
  onSelectProject,
  assistantConfigured,
  onOpenAssistant,
}: ChatEmptyStateProps) {
  const { t } = useTranslation();

  if (hasDirectory && hasProvider) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">{t('chat.empty.ready')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-6">
        {/* Dual entry point cards */}
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Project Chat card */}
          <Card className="flex-1 cursor-pointer">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CodePilotIcon name="folder_open" size="lg" className="text-primary" aria-hidden />
                <CardTitle className="text-base">{t('chat.empty.projectChat.title')}</CardTitle>
              </div>
              <CardDescription>{t('chat.empty.projectChat.description')}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button size="sm" className="gap-1.5" onClick={onSelectFolder}>
                <CodePilotIcon name="folder_open" size="sm" aria-hidden />
                {t('chat.empty.selectFolder')}
              </Button>
            </CardFooter>
          </Card>

          {/* Personal Assistant card */}
          <Card className="flex-1 cursor-pointer">
            <CardHeader>
              <div className="flex items-center gap-2">
                <img src={EGG_IMAGE_URL} alt="" width={24} height={24} className="shrink-0" />
                <CardTitle className="text-base">{t('chat.empty.assistant.title')}</CardTitle>
              </div>
              <CardDescription>{t('chat.empty.assistant.description')}</CardDescription>
            </CardHeader>
            <CardFooter>
              {assistantConfigured ? (
                <Button size="sm" className="gap-1.5" onClick={onOpenAssistant}>
                  <img src={EGG_IMAGE_URL} alt="" width={14} height={14} />
                  {t('chat.empty.assistant.open')}
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={onOpenAssistant}>
                  <img src={EGG_IMAGE_URL} alt="" width={14} height={14} />
                  {t('chat.empty.assistant.setup')}
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>

        {/* Explanation text */}
        <p className="text-xs text-center text-muted-foreground px-4">
          {t('chat.empty.explanation')}
        </p>

        {/* Provider setup prompt */}
        {!hasProvider && (
          <div className="space-y-2 text-center">
            <p className="text-sm font-medium">{t('chat.empty.noProvider')}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.dispatchEvent(new CustomEvent('open-setup-center', { detail: { initialCard: 'provider' } }))}
            >
              {t('chat.empty.openSetup')}
            </Button>
          </div>
        )}

        {/* Recent projects */}
        {recentProjects && recentProjects.length > 0 && onSelectProject && (
          <div className="space-y-1.5 text-center">
            <p className="text-xs text-muted-foreground">{t('chat.empty.recentProjects')}</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {recentProjects.slice(0, 5).map(p => {
                const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
                return (
                  <Button
                    key={p}
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px] font-mono"
                    onClick={() => onSelectProject(p)}
                    title={p}
                  >
                    {name}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sidebar promo card ─────────────────────────────────────────── */

interface AssistantPromoCardProps {
  onSetup: () => void;
  onDismiss: () => void;
}

export function AssistantPromoCard({ onSetup, onDismiss }: AssistantPromoCardProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('codepilot:assistant-promo-dismissed') === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem('codepilot:assistant-promo-dismissed', '1');
    } catch {
      // localStorage unavailable (private mode / restricted Electron) —
      // dismissal won't persist across sessions; degrade gracefully.
    }
    setDismissed(true);
    onDismiss();
  };

  return (
    <div className="relative mx-2 mb-2 rounded-xl border border-sidebar-border/60 bg-sidebar-accent/40 px-3 py-2.5 text-sidebar-foreground">
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        aria-label={t('chat.empty.assistant.dismiss')}
      >
        <X size={13} />
      </button>
      <div className="flex items-start gap-2.5 pr-7">
        <img src={EGG_IMAGE_URL} alt="" width={22} height={22} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-[18px]">
            {t('chat.empty.assistant.title')}
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {t('chat.empty.assistant.description')}
          </p>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="-ml-2 mt-1 h-6 px-2 text-xs"
            onClick={onSetup}
          >
            {t('chat.empty.assistant.setup')}
          </Button>
        </div>
      </div>
    </div>
  );
}
