'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { CaretDown, Gear } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import type { ProviderModelGroup } from '@/types';

interface ModelOption {
  value: string;
  label: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
}

interface ModelSelectorDropdownProps {
  currentModelValue: string;
  currentProviderIdValue: string;
  providerGroups: ProviderModelGroup[];
  modelOptions: ModelOption[];
  onModelChange?: (model: string) => void;
  onProviderModelChange?: (providerId: string, model: string) => void;
}

export function ModelSelectorDropdown({
  currentModelValue,
  currentProviderIdValue,
  providerGroups,
  modelOptions,
  onModelChange,
  onProviderModelChange,
}: ModelSelectorDropdownProps) {
  const { t } = useTranslation();
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');

  const currentModelOption = modelOptions.find((m) => m.value === currentModelValue) || modelOptions[0];

  // Click outside to close model menu
  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
        setModelSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelMenuOpen]);

  const handleModelSelect = useCallback((providerId: string, modelValue: string) => {
    onModelChange?.(modelValue);
    onProviderModelChange?.(providerId, modelValue);
    localStorage.setItem('codepilot:last-model', modelValue);
    localStorage.setItem('codepilot:last-provider-id', providerId);
    setModelMenuOpen(false);
    setModelSearch('');
  }, [onModelChange, onProviderModelChange]);

  const mq = modelSearch.toLowerCase();
  const filteredGroups = providerGroups.map(group => ({
    ...group,
    models: group.models.filter(opt =>
      !mq || opt.label.toLowerCase().includes(mq) || group.provider_name.toLowerCase().includes(mq)
    ),
  })).filter(group => group.models.length > 0);

  return (
    <div className="relative" ref={modelMenuRef}>
      <PromptInputButton
        onClick={() => setModelMenuOpen((prev) => !prev)}
      >
        <span className="text-xs font-mono">{currentModelOption?.label}</span>
        <CaretDown size={10} className={cn("transition-transform duration-200", modelMenuOpen && "rotate-180")} />
      </PromptInputButton>

      {modelMenuOpen && (
        <div className="absolute bottom-full left-0 mb-1.5 w-64 rounded-xl border bg-popover shadow-lg overflow-hidden z-50">
          {/* Search */}
          <div className="px-3 py-2 border-b">
            <input
              type="text"
              placeholder={t('composer.searchModels' as TranslationKey)}
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setModelMenuOpen(false);
                  setModelSearch('');
                }
              }}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
          {/* Model list */}
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredGroups.map((group, groupIdx) => (
              <div key={group.provider_id}>
                <div className={cn(
                  "px-3 py-1.5 text-[10px] font-medium text-muted-foreground",
                  groupIdx > 0 && "border-t"
                )}>
                  {group.provider_name}
                </div>
                <div className="py-0.5">
                  {group.models.map((opt) => {
                    const isActive = opt.value === currentModelValue && group.provider_id === currentProviderIdValue;
                    return (
                      <button
                        key={`${group.provider_id}-${opt.value}`}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                          isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                        )}
                        onClick={() => handleModelSelect(group.provider_id, opt.value)}
                      >
                        <span className="font-mono text-xs">{opt.label}</span>
                        {isActive && <span className="text-xs">&#10003;</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {filteredGroups.length === 0 && (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                No models found
              </div>
            )}
          </div>
          {/* Footer: manage providers */}
          <div className="border-t px-3 py-1.5">
            <button
              className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              onClick={() => { setModelMenuOpen(false); setModelSearch(''); window.location.href = '/settings'; }}
            >
              <Gear size={14} />
              {t('composer.manageProviders' as TranslationKey)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
