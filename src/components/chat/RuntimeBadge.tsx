'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';

interface RuntimeBadgeProps {
  providerId?: string;
}

type RuntimeMode = 'auto' | 'native' | 'claude-code-sdk';

const LABELS: Record<RuntimeMode, { en: string; zh: string }> = {
  auto: { en: 'Agent: Auto', zh: 'Agent 内核：自动' },
  native: { en: 'Agent: Native', zh: 'Agent 内核：原生' },
  'claude-code-sdk': { en: 'Agent: Claude Code', zh: 'Agent 内核：Claude Code' },
};

const DESCRIPTIONS: Record<RuntimeMode, { en: string; zh: string }> = {
  auto: {
    en: 'Auto-detect: uses Claude Code SDK if installed, otherwise Native Runtime',
    zh: '自动检测：安装了 Claude Code 则使用 SDK，否则使用原生 Runtime',
  },
  native: {
    en: 'Native Runtime: built-in AI SDK engine, no CLI required',
    zh: '原生 Runtime：内置 AI SDK 引擎，无需安装 CLI',
  },
  'claude-code-sdk': {
    en: 'Claude Code SDK: full CLI capabilities via subprocess',
    zh: 'Claude Code SDK：通过 CLI 子进程获得完整能力',
  },
};

export function RuntimeBadge({ providerId }: RuntimeBadgeProps) {
  const [runtimeSetting, setRuntimeSetting] = useState<RuntimeMode>('auto');
  const router = useRouter();
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  const isNonAnthropicProvider = providerId === 'openai-oauth';
  const effectiveRuntime: RuntimeMode = isNonAnthropicProvider ? 'native' : runtimeSetting;

  useEffect(() => {
    fetch('/api/settings/app')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const setting = data?.settings?.agent_runtime;
        if (setting && ['auto', 'native', 'claude-code-sdk'].includes(setting)) {
          setRuntimeSetting(setting as RuntimeMode);
        }
      })
      .catch(() => {});
  }, []);

  const label = LABELS[effectiveRuntime];
  const desc = DESCRIPTIONS[effectiveRuntime];

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-accent"
          onClick={() => router.push('/settings#cli')}
        >
          {isZh ? label.zh : label.en}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-56 p-3 text-xs">
        <p>{isZh ? desc.zh : desc.en}</p>
        {isNonAnthropicProvider && (
          <p className="mt-1.5 text-muted-foreground">
            {isZh ? 'OpenAI 模型始终使用原生 Runtime' : 'OpenAI models always use Native Runtime'}
          </p>
        )}
        <p className="mt-1.5 text-muted-foreground">
          {isZh ? '点击前往设置调整' : 'Click to adjust in settings'}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
