'use client';

/**
 * Top Tab strip for the right-side Workspace Sidebar.
 *
 * Visual order:
 *   [git] [widget] · [dynamic 1] [dynamic 2] ... · [collapse]
 *
 * Fixed Tabs are never closable. Dynamic Tabs render an `X` close
 * button on hover/focus. The shell collapse button sits at the very
 * right of the strip.
 *
 * Accessibility (Codex P3 finding 2026-04-30):
 *   - The Tab row is `role="tablist"`; each Tab is a `<button role="tab">`
 *     with `aria-selected` and managed `tabIndex` (active = 0,
 *     others = -1) so screen readers announce "selected" and keyboard
 *     focus follows the active Tab on first tab-into.
 *   - ArrowLeft / ArrowRight cycle focus + activate Tabs (WAI-ARIA
 *     Tabs pattern). Home / End jump to first / last.
 *   - Close button aria-labels include the Tab name so a screen reader
 *     hears "Close Git" rather than just "Close tab".
 */

import { useCallback, useRef } from 'react';
import { GitBranch, ChartBar, FileCode, Code, File, X, ArrowsIn, PushPin, FolderOpen } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { useWorkspaceSidebar } from '@/hooks/useWorkspaceSidebar';
import type { Tab } from '@/lib/workspace-sidebar';

interface TabBarProps {
  className?: string;
}

function tabLabel(tab: Tab, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  if (tab.kind === 'fixed') {
    if (tab.id === 'git') return t('workspaceSidebar.tab.git' as TranslationKey);
    return t('workspaceSidebar.tab.widget' as TranslationKey);
  }
  if (tab.kind === 'files-pinned') return t('workspaceSidebar.tab.files' as TranslationKey);
  return tab.title;
}

function tabIcon(tab: Tab): React.ReactNode {
  if (tab.kind === 'fixed') {
    return tab.id === 'git' ? <GitBranch size={14} /> : <ChartBar size={14} />;
  }
  if (tab.kind === 'files-pinned') return <PushPin size={14} />;
  if (tab.kind === 'markdown' || tab.kind === 'file') {
    const ext = (tab.kind === 'markdown' ? '.md' : tab.filePath.split('.').pop() || '').toLowerCase();
    if (ext.endsWith('.md') || tab.kind === 'markdown') return <File size={14} />;
    if (['.ts', '.tsx', '.js', '.jsx', '.py'].includes(`.${ext}`)) return <Code size={14} />;
    return <FileCode size={14} />;
  }
  // artifact
  return <FolderOpen size={14} />;
}

export function TabBar({ className }: TabBarProps) {
  const { state, setActiveTab, closeTab, setOpen } = useWorkspaceSidebar();
  const { t } = useTranslation();
  // Refs to each Tab button so ArrowLeft/ArrowRight focus moves keep
  // the visual focus ring in sync with `activeTabId`.
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentId: string) => {
      const tabs = state.tabs;
      const idx = tabs.findIndex((t) => t.id === currentId);
      if (idx === -1) return;
      let nextIdx = idx;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      else return;
      e.preventDefault();
      const nextId = tabs[nextIdx]?.id;
      if (!nextId) return;
      setActiveTab(nextId);
      // Move keyboard focus to the newly-activated Tab so the WAI-ARIA
      // automatic-activation Tabs pattern feels natural.
      requestAnimationFrame(() => {
        tabRefs.current.get(nextId)?.focus();
      });
    },
    [state.tabs, setActiveTab],
  );

  return (
    <div
      role="tablist"
      aria-label={t('workspaceSidebar.toggle' as TranslationKey)}
      aria-orientation="horizontal"
      className={cn(
        'flex shrink-0 items-center gap-0.5 border-b border-border/40 bg-background px-2 py-1.5 overflow-x-auto',
        className,
      )}
      data-workspace-sidebar-tabbar
    >
      {state.tabs.map((tab) => {
        const isActive = tab.id === state.activeTabId;
        const closable = tab.kind !== 'fixed';
        const label = tabLabel(tab, t);
        return (
          <div
            key={tab.id}
            className={cn(
              'group flex items-center gap-1.5 rounded-md text-xs transition-colors',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
            data-tab-id={tab.id}
            data-tab-active={isActive || undefined}
          >
            <button
              type="button"
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls="workspace-sidebar-tabpanel"
              tabIndex={isActive ? 0 : -1}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              className="flex items-center gap-1.5 rounded-md pl-2 pr-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
            >
              <span className="text-muted-foreground/80">{tabIcon(tab)}</span>
              <span className="max-w-[160px] truncate">{label}</span>
            </button>
            {closable && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label={t('workspaceSidebar.closeTabNamed' as TranslationKey, { name: label })}
                className="mr-0.5 h-4 w-4 p-0 opacity-0 transition-opacity group-hover:opacity-100 data-[active]:opacity-100"
                data-active={isActive || undefined}
              >
                <X size={10} />
              </Button>
            )}
          </div>
        );
      })}
      {/* Spacer pushes the collapse button to the far right. */}
      <div className="flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(false)}
        aria-label={t('workspaceSidebar.collapse' as TranslationKey)}
        className="shrink-0 text-muted-foreground/70 hover:text-foreground"
      >
        <ArrowsIn size={14} />
      </Button>
    </div>
  );
}
