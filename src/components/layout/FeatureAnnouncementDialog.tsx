'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';

// Bump this key when there's a new announcement to show
const ANNOUNCEMENT_KEY = 'codepilot:announcement:v0.48-agent-engine';

export function FeatureAnnouncementDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem(ANNOUNCEMENT_KEY)) {
      const timer = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    setOpen(false);
    localStorage.setItem(ANNOUNCEMENT_KEY, '1');
  };

  const handleGoToSettings = () => {
    handleDismiss();
    router.push('/settings#cli');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isZh ? '全新 Agent 内核' : 'New Agent Engine'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            {isZh
              ? <>本次更新涉及底层架构变更，虽已详细测试但仍可能存在问题。如遇异常请到 <a href="https://github.com/op7418/CodePilot/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium">GitHub Issues</a> 反馈。</>
              : <>This update involves significant architectural changes. While thoroughly tested, issues may still occur. Please report any problems on <a href="https://github.com/op7418/CodePilot/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium">GitHub Issues</a>.</>
            }
          </div>
          {isZh ? (
            <>
              <p>CodePilot 现在无需安装 Claude Code CLI 也能完整运行。</p>
              <div className="space-y-2 text-muted-foreground">
                <p><span className="text-foreground font-medium">AI SDK 内核</span> — 内置多模型引擎，开箱即用，支持所有已配置的服务商</p>
                <p><span className="text-foreground font-medium">Claude Code 内核</span> — 通过 Claude Code CLI 驱动，获得完整的 CLI 能力</p>
              </div>
              <p>同时支持 <span className="font-medium">OpenAI 授权登录</span>，ChatGPT Plus/Pro 用户可在服务商设置中登录后直接使用 GPT-5.4 等模型。</p>
            </>
          ) : (
            <>
              <p>CodePilot now runs fully without the Claude Code CLI.</p>
              <div className="space-y-2 text-muted-foreground">
                <p><span className="text-foreground font-medium">AI SDK engine</span> — built-in multi-model engine, works out of the box with all configured providers</p>
                <p><span className="text-foreground font-medium">Claude Code engine</span> — driven by Claude Code CLI for full CLI capabilities</p>
              </div>
              <p>Also supports <span className="font-medium">OpenAI OAuth login</span> — ChatGPT Plus/Pro users can sign in under Providers to use GPT-5.4 and more.</p>
            </>
          )}
        </div>

        <DialogFooter className="gap-3">
          <Button variant="outline" size="sm" onClick={handleGoToSettings}>
            {isZh ? '前往设置' : 'Go to Settings'}
          </Button>
          <Button size="sm" onClick={handleDismiss}>
            {isZh ? '知道了' : 'Got it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
