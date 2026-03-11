'use client';

import { useCallback } from 'react';
import { Terminal } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

export interface CliToolItem {
  id: string;
  name: string;
  version: string | null;
  summary: string;
}

interface CliToolsPopoverProps {
  popoverRef: React.RefObject<HTMLDivElement | null>;
  cliTools: CliToolItem[];
  cliFilter: string;
  selectedIndex: number;
  cliSearchRef: React.RefObject<HTMLInputElement | null>;
  onSetCliFilter: (filter: string) => void;
  onSetSelectedIndex: (index: number) => void;
  onCliSelect: (tool: CliToolItem) => void;
  onClosePopover: () => void;
  onFocusTextarea: () => void;
}

export function CliToolsPopover({
  popoverRef,
  cliTools,
  cliFilter,
  selectedIndex,
  cliSearchRef,
  onSetCliFilter,
  onSetSelectedIndex,
  onCliSelect,
  onClosePopover,
  onFocusTextarea,
}: CliToolsPopoverProps) {
  const { t } = useTranslation();

  const q = cliFilter.toLowerCase();
  const filtered = cliTools.filter(tool =>
    tool.name.toLowerCase().includes(q) || tool.summary.toLowerCase().includes(q)
  );

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onSetSelectedIndex(Math.min(selectedIndex + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onSetSelectedIndex(Math.max(selectedIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) onCliSelect(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClosePopover();
      onFocusTextarea();
    }
  }, [selectedIndex, filtered, onSetSelectedIndex, onCliSelect, onClosePopover, onFocusTextarea]);

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-2 w-full max-w-2xl rounded-xl border bg-popover shadow-lg overflow-hidden z-50"
    >
      <div className="px-3 py-2 border-b">
        <input
          ref={cliSearchRef}
          type="text"
          placeholder={t('cliTools.searchPlaceholder' as TranslationKey)}
          value={cliFilter}
          onChange={(e) => { onSetCliFilter(e.target.value); onSetSelectedIndex(0); }}
          onKeyDown={handleSearchKeyDown}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
      </div>
      <div className="max-h-48 overflow-y-auto py-1">
        {filtered.length > 0 ? (
          filtered.map((tool, idx) => (
            <button
              key={tool.id}
              ref={idx === selectedIndex ? (el) => { el?.scrollIntoView({ block: 'nearest' }); } : undefined}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                idx === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              )}
              onClick={() => onCliSelect(tool)}
              onMouseEnter={() => onSetSelectedIndex(idx)}
            >
              <Terminal size={16} className="shrink-0 text-muted-foreground" />
              <span className="font-medium text-xs truncate">{tool.name}</span>
              {tool.version && (
                <span className="text-[10px] text-muted-foreground shrink-0">v{tool.version}</span>
              )}
              {tool.summary && (
                <span className="text-xs text-muted-foreground truncate ml-auto max-w-[200px]">{tool.summary}</span>
              )}
            </button>
          ))
        ) : (
          <div className="px-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">{t('cliTools.noToolsDetected' as TranslationKey)}</p>
            <button
              className="mt-2 text-xs text-primary hover:underline"
              onClick={() => { onClosePopover(); window.location.href = '/cli-tools'; }}
            >
              {t('cliTools.goInstall' as TranslationKey)}
            </button>
          </div>
        )}
      </div>
      {/* Footer: manage CLI tools */}
      <div className="border-t px-3 py-1.5">
        <button
          className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          onClick={() => { onClosePopover(); window.location.href = '/cli-tools'; }}
        >
          <Terminal size={14} />
          {t('cliTools.manageCli' as TranslationKey)}
        </button>
      </div>
    </div>
  );
}
