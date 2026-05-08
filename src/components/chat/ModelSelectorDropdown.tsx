'use client';

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { CaretDown } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import type { ProviderModelGroup } from '@/types';
import { compatLabel, compatTone } from '@/lib/runtime-compat';
import {
  CommandList,
  CommandListItems,
  CommandListItem,
  CommandListGroup,
} from '@/components/patterns';

// Recent-models tracking. Persisted to localStorage so the picker can
// surface "刚用过的几个" at the top — an alternative to a global search
// box (per April 2026 user feedback: search adds noise; recent-list
// covers 80% of the "I want to switch back to that one" intent).
const RECENT_MODELS_KEY = 'codepilot:recent-models';
const RECENT_MODELS_DISPLAY = 3;
const RECENT_MODELS_STORED = 8;

interface RecentModelEntry {
  providerId: string;
  modelValue: string;
  ts: number;
}

function readRecentModels(): RecentModelEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_MODELS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is RecentModelEntry =>
      e && typeof e.providerId === 'string' && typeof e.modelValue === 'string' && typeof e.ts === 'number',
    );
  } catch {
    return [];
  }
}

function pushRecentModel(providerId: string, modelValue: string): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readRecentModels();
    const filtered = existing.filter(e => !(e.providerId === providerId && e.modelValue === modelValue));
    const next: RecentModelEntry[] = [
      { providerId, modelValue, ts: Date.now() },
      ...filtered,
    ].slice(0, RECENT_MODELS_STORED);
    localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}

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
  /** Global default model value */
  globalDefaultModel?: string;
  /** Global default model's provider ID */
  globalDefaultProvider?: string;
  /** Which runtime the picker feed was filtered against (server-resolved
   *  when caller passed `?runtime=auto`). Surfaced as a small status row
   *  inside the dropdown so users understand why some configured
   *  providers may not appear. */
  runtimeApplied?: 'claude_code' | 'codepilot_runtime';
  /** Whether the provider/model fetch is still in flight. When true we
   *  show a "loading" label on the trigger instead of an empty button so
   *  the composer doesn't look broken during the brief async window. */
  isLoading?: boolean;
}

export function ModelSelectorDropdown({
  currentModelValue,
  currentProviderIdValue,
  providerGroups,
  modelOptions,
  onModelChange,
  onProviderModelChange,
  globalDefaultModel,
  globalDefaultProvider,
  runtimeApplied,
  isLoading,
}: ModelSelectorDropdownProps) {
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  // Recent-model entries that still resolve to a (provider, model) pair
  // present in the current `providerGroups`. Re-read from localStorage
  // each time the menu opens so it reflects the latest selections, but
  // memoised against `providerGroups` so the matching pass only re-runs
  // when the data actually changes.
  const recentMatches = useMemo(() => {
    if (!modelMenuOpen) return [] as Array<{ group: ProviderModelGroup; option: ModelOption }>;
    const recent = readRecentModels();
    if (recent.length === 0) return [];
    const matches: Array<{ group: ProviderModelGroup; option: ModelOption }> = [];
    for (const entry of recent) {
      const group = providerGroups.find(g => g.provider_id === entry.providerId);
      if (!group) continue;
      const option = group.models.find(m => m.value === entry.modelValue);
      if (!option) continue;
      matches.push({ group, option });
      if (matches.length >= RECENT_MODELS_DISPLAY) break;
    }
    return matches;
  }, [modelMenuOpen, providerGroups]);

  const currentModelOption = modelOptions.find((m) => m.value === currentModelValue) || modelOptions[0];

  const isCurrentDefault = !!(
    globalDefaultModel &&
    globalDefaultProvider &&
    currentModelValue === globalDefaultModel &&
    currentProviderIdValue === globalDefaultProvider
  );

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
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
    pushRecentModel(providerId, modelValue);
    setModelMenuOpen(false);
  }, [onModelChange, onProviderModelChange]);

  const showLoading = isLoading || !currentModelOption;

  return (
    <div className="relative" ref={modelMenuRef}>
      <PromptInputButton
        onClick={() => setModelMenuOpen((prev) => !prev)}
        disabled={showLoading}
      >
        {showLoading ? (
          <span className="text-xs text-muted-foreground">
            {t('composer.modelLoading' as TranslationKey)}
          </span>
        ) : (
          <>
            <span className="text-xs font-mono">{currentModelOption?.label}</span>
            {isCurrentDefault && (
              <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">
                {isZh ? '· 默认' : '· Default'}
              </span>
            )}
          </>
        )}
        <CaretDown size={10} className={cn("transition-transform duration-200", modelMenuOpen && "rotate-180")} />
      </PromptInputButton>

      {modelMenuOpen && (
        <CommandList className="w-80 mb-1.5">
          {runtimeApplied && (
            <div className="px-3 pt-3 pb-1 text-[11px] leading-snug text-muted-foreground">
              {isZh
                ? '仅显示当前 Agent 引擎可用的模型'
                : 'Models available under the current Agent engine'}
            </div>
          )}
          <CommandListItems className="max-h-80">
            {recentMatches.length > 0 && (
              <CommandListGroup label={t('composer.recentModels' as TranslationKey)}>
                {recentMatches.map(({ group, option }) => {
                  const isActive = option.value === currentModelValue && group.provider_id === currentProviderIdValue;
                  return (
                    <CommandListItem
                      key={`recent-${group.provider_id}-${option.value}`}
                      active={isActive}
                      onClick={() => handleModelSelect(group.provider_id, option.value)}
                    >
                      <span className="font-mono text-xs truncate">{option.label}</span>
                      <span className="ml-auto text-[10px] font-normal text-muted-foreground truncate max-w-[100px]">
                        {group.provider_name}
                      </span>
                    </CommandListItem>
                  );
                })}
              </CommandListGroup>
            )}
            {providerGroups.map((group, groupIdx) => (
              <CommandListGroup
                key={group.provider_id}
                label={
                  <span className="flex items-center gap-1.5">
                    <span>{group.provider_name}</span>
                    {group.compat && (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-medium',
                          compatTone(group.compat),
                        )}
                      >
                        {compatLabel(group.compat, isZh)}
                      </span>
                    )}
                  </span>
                }
              >
                {group.models.map((opt) => {
                  const isActive = opt.value === currentModelValue && group.provider_id === currentProviderIdValue;
                  const isDefault = !!(
                    globalDefaultModel &&
                    globalDefaultProvider &&
                    opt.value === globalDefaultModel &&
                    group.provider_id === globalDefaultProvider
                  );
                  return (
                    <CommandListItem
                      key={`${group.provider_id}-${opt.value}`}
                      active={isActive}
                      onClick={() => handleModelSelect(group.provider_id, opt.value)}
                    >
                      <span className="font-mono text-xs truncate">{opt.label}</span>
                      {isDefault && (
                        <span className="ml-auto text-[10px] font-medium text-muted-foreground">
                          {isZh ? '默认' : 'Default'}
                        </span>
                      )}
                    </CommandListItem>
                  );
                })}
              </CommandListGroup>
            ))}
            {providerGroups.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {isZh ? '当前执行引擎 下暂无可用模型' : 'No models available under the current Runtime'}
              </div>
            )}
          </CommandListItems>
        </CommandList>
      )}
    </div>
  );
}
