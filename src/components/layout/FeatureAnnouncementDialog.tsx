'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';

// Bump this key when there's a new announcement to show
const ANNOUNCEMENT_KEY = 'codepilot:announcement:v0.48-agent-engine';

export function FeatureAnnouncementDialog() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  useEffect(() => {
    // Only show once per announcement
    if (typeof window !== 'undefined' && !localStorage.getItem(ANNOUNCEMENT_KEY)) {
      // Small delay so it doesn't flash on initial load
      const timer = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    setOpen(false);
    localStorage.setItem(ANNOUNCEMENT_KEY, '1');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isZh ? '新功能：独立 Agent 内核 + OpenAI 支持' : 'New: Independent Agent Engine + OpenAI Support'}
          </DialogTitle>
          <DialogDescription>
            {isZh ? 'CodePilot 现在可以脱离 Claude Code CLI 独立运行' : 'CodePilot can now run independently without Claude Code CLI'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium mb-1">{isZh ? 'Agent 内核选择' : 'Agent Engine Selection'}</p>
            <p className="text-muted-foreground">
              {isZh
                ? '在设置页可以选择 Agent 内核：AI SDK（无需安装任何 CLI，支持多模型）或 Claude Code（需安装 CLI，完整 CLI 能力）。默认自动模式会根据 CLI 是否安装自动选择。'
                : 'In Settings, choose your Agent engine: AI SDK (no CLI needed, multi-model) or Claude Code (requires CLI, full CLI capabilities). Auto mode selects based on CLI availability.'}
            </p>
          </div>

          <div>
            <p className="font-medium mb-1">{isZh ? 'OpenAI 授权登录' : 'OpenAI OAuth Login'}</p>
            <p className="text-muted-foreground">
              {isZh
                ? 'ChatGPT Plus/Pro 用户可以在设置 → 服务商页面通过 OAuth 登录 OpenAI，直接使用 GPT-5.4 等模型。选择 OpenAI 模型时会自动使用 AI SDK 内核。'
                : 'ChatGPT Plus/Pro users can log in via OAuth in Settings → Providers to use GPT-5.4 and other models. OpenAI models automatically use the AI SDK engine.'}
            </p>
          </div>

          <div className="rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
            {isZh
              ? '设置位置：设置 → Agent 内核（第一张卡片）'
              : 'Settings location: Settings → Agent Engine (first card)'}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleDismiss} size="sm">
            {isZh ? '知道了' : 'Got it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
