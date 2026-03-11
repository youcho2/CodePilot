'use client';

import { useCallback } from 'react';
import {
  At,
  Terminal,
  NotePencil,
  Brain,
  GlobeSimple,
  Lightning,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { SkillKind } from '@/types';

export interface PopoverItem {
  label: string;
  value: string;
  description?: string;
  descriptionKey?: TranslationKey;
  builtIn?: boolean;
  immediate?: boolean;
  installedSource?: 'agents' | 'claude';
  source?: 'global' | 'project' | 'plugin' | 'installed' | 'sdk';
  kind?: SkillKind;
  icon?: Icon;
}

export type PopoverMode = 'file' | 'skill' | 'cli' | null;

interface SlashCommandPopoverProps {
  popoverMode: PopoverMode;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  filteredItems: PopoverItem[];
  aiSuggestions: PopoverItem[];
  aiSearchLoading: boolean;
  selectedIndex: number;
  popoverFilter: string;
  inputValue: string;
  triggerPos: number | null;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  allDisplayedItems: PopoverItem[];
  onInsertItem: (item: PopoverItem) => void;
  onSetSelectedIndex: (index: number) => void;
  onSetPopoverFilter: (filter: string) => void;
  onSetInputValue: (value: string) => void;
  onClosePopover: () => void;
  onFocusTextarea: () => void;
}

export function SlashCommandPopover({
  popoverMode,
  popoverRef,
  filteredItems,
  aiSuggestions,
  aiSearchLoading,
  selectedIndex,
  popoverFilter,
  inputValue,
  triggerPos,
  searchInputRef,
  allDisplayedItems,
  onInsertItem,
  onSetSelectedIndex,
  onSetPopoverFilter,
  onSetInputValue,
  onClosePopover,
  onFocusTextarea,
}: SlashCommandPopoverProps) {
  const { t } = useTranslation();

  const builtInItems = filteredItems.filter(item => item.builtIn);
  const slashCommandItems = filteredItems.filter(item => !item.builtIn && item.kind !== 'agent_skill');
  const agentSkillItems = filteredItems.filter(item => !item.builtIn && item.kind === 'agent_skill');
  let globalIdx = 0;

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onSetSelectedIndex((selectedIndex + 1) % allDisplayedItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onSetSelectedIndex((selectedIndex - 1 + allDisplayedItems.length) % allDisplayedItems.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (allDisplayedItems[selectedIndex]) {
        onInsertItem(allDisplayedItems[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClosePopover();
      onFocusTextarea();
    }
  }, [selectedIndex, allDisplayedItems, onSetSelectedIndex, onInsertItem, onClosePopover, onFocusTextarea]);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onSetPopoverFilter(val);
    onSetSelectedIndex(0);
    // Sync textarea: replace the filter portion after /
    if (triggerPos !== null) {
      const before = inputValue.slice(0, triggerPos + 1);
      onSetInputValue(before + val);
    }
  }, [triggerPos, inputValue, onSetPopoverFilter, onSetSelectedIndex, onSetInputValue]);

  const renderItem = (item: PopoverItem, idx: number) => (
    <button
      key={`${idx}-${item.value}`}
      ref={idx === selectedIndex ? (el) => { el?.scrollIntoView({ block: 'nearest' }); } : undefined}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
        idx === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      )}
      onClick={() => onInsertItem(item)}
      onMouseEnter={() => onSetSelectedIndex(idx)}
    >
      {popoverMode === 'file' ? (
        <At size={16} className="shrink-0 text-muted-foreground" />
      ) : item.builtIn && item.icon ? (
        (() => { const ItemIcon = item.icon; return <ItemIcon size={16} className="shrink-0 text-muted-foreground" />; })()
      ) : item.kind === 'agent_skill' ? (
        <Brain size={16} className="shrink-0 text-muted-foreground" />
      ) : item.kind === 'slash_command' ? (
        <NotePencil size={16} className="shrink-0 text-muted-foreground" />
      ) : !item.builtIn ? (
        <GlobeSimple size={16} className="shrink-0 text-muted-foreground" />
      ) : (
        <Terminal size={16} className="shrink-0 text-muted-foreground" />
      )}
      <span className="font-mono text-xs truncate">{item.label}</span>
      {(item.descriptionKey || item.description) && (
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {item.descriptionKey ? t(item.descriptionKey) : item.description}
        </span>
      )}
      {!item.builtIn && item.installedSource && (
        <span className="text-xs text-muted-foreground shrink-0 ml-auto">
          {item.installedSource === 'claude' ? 'Personal' : 'Agents'}
        </span>
      )}
    </button>
  );

  if (!popoverMode || popoverMode === 'cli') return null;
  if (allDisplayedItems.length === 0 && !aiSearchLoading) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-2 w-full max-w-2xl rounded-xl border bg-popover shadow-lg overflow-hidden z-50"
    >
      {popoverMode === 'skill' ? (
        <div className="px-3 py-2 border-b">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search..."
            value={popoverFilter}
            onChange={handleFilterChange}
            onKeyDown={handleSearchKeyDown}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
      ) : (
        <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
          Files
        </div>
      )}
      <div className="max-h-48 overflow-y-auto py-1">
        {popoverMode === 'file' ? (
          filteredItems.map((item, i) => renderItem(item, i))
        ) : (
          <>
            {builtInItems.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Commands
                </div>
                {builtInItems.map((item) => {
                  const idx = globalIdx++;
                  return renderItem(item, idx);
                })}
              </>
            )}
            {slashCommandItems.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Slash Commands
                </div>
                {slashCommandItems.map((item) => {
                  const idx = globalIdx++;
                  return renderItem(item, idx);
                })}
              </>
            )}
            {agentSkillItems.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Agent Skills
                </div>
                {agentSkillItems.map((item) => {
                  const idx = globalIdx++;
                  return renderItem(item, idx);
                })}
              </>
            )}
            {/* AI Suggested section */}
            {(aiSuggestions.length > 0 || aiSearchLoading) && (
              <>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Brain size={14} />
                  {t('messageInput.aiSuggested')}
                  {aiSearchLoading && (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  )}
                </div>
                {aiSuggestions.map((item) => {
                  const idx = globalIdx++;
                  return renderItem(item, idx);
                })}
              </>
            )}
          </>
        )}
      </div>
      {/* Footer: manage skills (skill mode only) */}
      {popoverMode === 'skill' && (
        <div className="border-t px-3 py-1.5">
          <button
            className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            onClick={() => { onClosePopover(); window.location.href = '/skills'; }}
          >
            <Lightning size={14} />
            {t('composer.manageSkills' as TranslationKey)}
          </button>
        </div>
      )}
    </div>
  );
}
