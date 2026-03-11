'use client';

import { useRef, useState, useEffect } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';

interface EffortSelectorDropdownProps {
  selectedEffort: string;
  onEffortChange: (effort: string) => void;
  supportedEffortLevels?: string[];
}

export function EffortSelectorDropdown({
  selectedEffort,
  onEffortChange,
  supportedEffortLevels,
}: EffortSelectorDropdownProps) {
  const { t } = useTranslation();
  const effortMenuRef = useRef<HTMLDivElement>(null);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);

  const levels = supportedEffortLevels || ['low', 'medium', 'high', 'max'];

  // Close effort menu on outside click
  useEffect(() => {
    if (!effortMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (effortMenuRef.current && !effortMenuRef.current.contains(e.target as Node)) {
        setEffortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [effortMenuOpen]);

  return (
    <div className="relative" ref={effortMenuRef}>
      <PromptInputButton
        onClick={() => setEffortMenuOpen((prev) => !prev)}
      >
        <span className="text-xs">{t(`messageInput.effort.${selectedEffort}` as TranslationKey)}</span>
        <CaretDown size={10} className={cn("transition-transform duration-200", effortMenuOpen && "rotate-180")} />
      </PromptInputButton>

      {effortMenuOpen && (
        <div className="absolute bottom-full left-0 mb-1.5 w-36 rounded-lg border bg-popover shadow-lg overflow-hidden z-50">
          <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
            {t('messageInput.effort.label' as TranslationKey)}
          </div>
          <div className="py-0.5">
            {levels.map((level) => (
              <button
                key={level}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                  selectedEffort === level ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                )}
                onClick={() => {
                  onEffortChange(level);
                  setEffortMenuOpen(false);
                }}
              >
                <span className="text-xs">{t(`messageInput.effort.${level}` as TranslationKey)}</span>
                {selectedEffort === level && <span className="text-xs">&#10003;</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
