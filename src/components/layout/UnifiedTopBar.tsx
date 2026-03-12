"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  GitBranch,
  GitCommit,
  CloudArrowUp,
  TreeStructure,
  Terminal,
  PencilSimple,
  DotOutline,
  CaretDown,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { CommitDialog } from "@/components/git/CommitDialog";

export function UnifiedTopBar() {
  const {
    sessionTitle,
    setSessionTitle,
    sessionId,
    workingDirectory,
    fileTreeOpen,
    setFileTreeOpen,
    gitPanelOpen,
    setGitPanelOpen,
    terminalOpen,
    setTerminalOpen,
    currentBranch,
    gitDirtyCount,
  } = usePanel();
  const { t } = useTranslation();
  const pathname = usePathname();

  // Only show Git/terminal/panel controls on chat detail routes (/chat/[id]),
  // not on the empty /chat page where panels aren't mounted.
  const isChatRoute = pathname.startsWith("/chat/") && pathname !== "/chat";

  // --- Title editing ---
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const handleStartEditTitle = useCallback(() => {
    setEditTitle(sessionTitle || t('chat.newConversation'));
    setIsEditingTitle(true);
  }, [sessionTitle, t]);

  const handleSaveTitle = useCallback(async () => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setIsEditingTitle(false);
      return;
    }
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        setSessionTitle(trimmed);
        window.dispatchEvent(new CustomEvent('session-updated', { detail: { id: sessionId, title: trimmed } }));
      }
    } catch {
      // silently fail
    }
    setIsEditingTitle(false);
  }, [editTitle, sessionId, setSessionTitle]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
    }
  }, [handleSaveTitle]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // --- Commit dialog ---
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);

  const handleCommitSuccess = useCallback(() => {
    // Trigger git status refresh via custom event
    window.dispatchEvent(new CustomEvent('git-refresh'));
  }, []);

  // --- Push handler ---
  const [pushing, setPushing] = useState(false);
  const [pushMessage, setPushMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const handlePush = useCallback(async () => {
    if (!workingDirectory || pushing) return;
    setPushing(true);
    setPushMessage(null);
    try {
      const res = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Push failed' }));
        setPushMessage({ type: 'error', text: data.error || 'Push failed' });
        return;
      }
      setPushMessage({ type: 'success', text: t('git.pushSuccess') });
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      setPushMessage({ type: 'error', text: err instanceof Error ? err.message : 'Push failed' });
    } finally {
      setPushing(false);
    }
  }, [workingDirectory, pushing, t]);

  // Auto-dismiss push message after 4s
  useEffect(() => {
    if (!pushMessage) return;
    const timer = setTimeout(() => setPushMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [pushMessage]);

  // Extract project name from working directory
  const projectName = workingDirectory ? workingDirectory.split('/').pop() || '' : '';

  return (
    <>
      <div
        className="flex h-12 shrink-0 items-center gap-2 bg-background px-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: chat title + project folder */}
        <div
          className="flex items-center gap-1.5 min-w-0 shrink"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isChatRoute && sessionTitle && (
            isEditingTitle ? (
              <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <Input
                  ref={titleInputRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={handleSaveTitle}
                  className="h-7 text-sm max-w-[200px]"
                />
              </div>
            ) : (
              <div className="flex items-center gap-1 cursor-default max-w-[200px]">
                <h2 className="text-sm font-medium text-foreground/80 truncate">
                  {sessionTitle}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleStartEditTitle}
                  className="shrink-0 h-auto w-auto p-0.5"
                >
                  <PencilSimple size={12} className="text-muted-foreground" />
                </Button>
              </div>
            )
          )}

          {isChatRoute && projectName && sessionTitle && (
            <span className="text-xs text-muted-foreground/60 shrink-0">/</span>
          )}

          {isChatRoute && projectName && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground/60 shrink-0 hover:text-foreground transition-colors h-auto p-0"
                  onClick={() => {
                    if (workingDirectory) {
                      if (window.electronAPI?.shell?.openPath) {
                        window.electronAPI.shell.openPath(workingDirectory);
                      } else {
                        fetch('/api/files/open', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: workingDirectory }),
                        }).catch(() => {});
                      }
                    }
                  }}
                >
                  {projectName}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs break-all">{workingDirectory}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: action buttons */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isChatRoute && (
            <>
              {/* Commit button + Push dropdown */}
              <div className="flex items-center border border-border rounded-md">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCommitDialogOpen(true)}
                  className="rounded-r-none h-7 px-2 text-xs gap-1"
                >
                  <GitCommit size={14} />
                  {t('topBar.commit')}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-l-none border-l border-border h-7 px-1 min-w-0"
                    >
                      <CaretDown size={10} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="bottom">
                    <DropdownMenuItem onClick={() => setCommitDialogOpen(true)}>
                      <GitCommit size={14} className="mr-2" />
                      {t('topBar.commit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handlePush} disabled={pushing}>
                      <CloudArrowUp size={14} className="mr-2" />
                      {pushing ? t('git.loading') : t('topBar.push')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {pushMessage && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${pushMessage.type === 'error' ? 'text-destructive' : 'text-emerald-600'}`}>
                  {pushMessage.text}
                </span>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={gitPanelOpen ? "secondary" : "ghost"}
                    size="sm"
                    className={`h-7 gap-1 px-1.5 ${gitPanelOpen ? "" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setGitPanelOpen(!gitPanelOpen)}
                  >
                    <GitBranch size={16} />
                    {currentBranch && (
                      <span className="text-xs max-w-[100px] truncate">{currentBranch}</span>
                    )}
                    {gitDirtyCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-amber-500">
                        <DotOutline size={10} weight="fill" />
                        {gitDirtyCount}
                      </span>
                    )}
                    <span className="sr-only">{t('topBar.git')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('topBar.git')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={terminalOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={terminalOpen ? "" : "text-muted-foreground hover:text-foreground"}
                    onClick={() => setTerminalOpen(!terminalOpen)}
                  >
                    <Terminal size={16} />
                    <span className="sr-only">{t('topBar.terminal')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('topBar.terminal')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={fileTreeOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={fileTreeOpen ? "" : "text-muted-foreground hover:text-foreground"}
                    onClick={() => setFileTreeOpen(!fileTreeOpen)}
                  >
                    <TreeStructure size={16} />
                    <span className="sr-only">{t('topBar.fileTree')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('topBar.fileTree')}</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Commit Dialog */}
      <CommitDialog
        cwd={workingDirectory}
        open={commitDialogOpen}
        onClose={() => setCommitDialogOpen(false)}
        onSuccess={handleCommitSuccess}
      />
    </>
  );
}
