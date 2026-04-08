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
  native: { en: 'Agent: AI SDK', zh: 'Agent 内核：AI SDK' },
  'claude-code-sdk': { en: 'Agent: Claude Code', zh: 'Agent 内核：Claude Code' },
};

const DESCRIPTIONS: Record<RuntimeMode, { en: string; zh: string }> = {
  auto: {
    en: 'Auto: uses Claude Code when installed, otherwise AI SDK',
    zh: '自动：安装了 Claude Code 则使用 Claude Code，否则使用 AI SDK',
  },
  native: {
    en: 'AI SDK: built-in multi-model engine, no CLI required',
    zh: 'AI SDK：内置多模型引擎，无需安装 CLI',
  },
  'claude-code-sdk': {
    en: 'Claude Code: full CLI capabilities via subprocess',
    zh: 'Claude Code：通过 CLI 子进程获得完整能力',
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
            {isZh ? 'OpenAI 模型始终使用 AI SDK 引擎' : 'OpenAI models always use AI SDK engine'}
          </p>
        )}
        <p className="mt-1.5 text-muted-foreground">
          {isZh ? '点击前往设置调整' : 'Click to adjust in settings'}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
