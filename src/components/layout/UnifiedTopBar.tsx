"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  GitBranch,
  TreeStructure,
  DotOutline,
  DotsThree,
  Trash,
  Columns,
  Copy,
  PencilSimple,
  SidebarSimple,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePanel } from "@/hooks/usePanel";
import { useWorkspaceSidebarOptional } from "@/hooks/useWorkspaceSidebar";
import { useSplit } from "@/hooks/useSplit";
import { useTranslation } from "@/hooks/useTranslation";
import { useClientPlatform } from '@/hooks/useClientPlatform';
import type { TranslationKey } from "@/i18n";

export function UnifiedTopBar() {
  const {
    sessionId,
    sessionTitle,
    setSessionTitle,
    workingDirectory,
    chatListOpen,
    setChatListOpen,
    fileTreeOpen,
    setFileTreeOpen,
    isAssistantWorkspace,
    currentBranch,
    gitDirtyCount,
  } = usePanel();
  // The new Workspace Sidebar replaces the old Git / Widget toggles.
  // FileTree keeps its independent toggle (lightweight entry); the
  // sidebar is for the unified Tab shell only.
  const ws = useWorkspaceSidebarOptional();
  const { addToSplit, isInSplit } = useSplit();
  const router = useRouter();
  const { t } = useTranslation();
  const { isWindows } = useClientPlatform();
  const pathname = usePathname();

  // Only show Git/terminal/panel controls on chat detail routes (/chat/[id]),
  // not on the empty /chat page where panels aren't mounted.
  const isChatRoute = pathname.startsWith("/chat/") && pathname !== "/chat";

  // Session actions menu (mirrors the chat list's row "..." menu so users
  // get the same set of actions on the active chat from inside the chat
  // page itself).
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const handleRename = useCallback(async (newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed || !sessionId || trimmed === sessionTitle) return;
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
      // Silent — fail-soft like the sidebar handler.
    }
  }, [sessionId, sessionTitle, setSessionTitle]);

  const handleDelete = useCallback(async () => {
    if (!sessionId) return;
    if (!confirm("Delete this conversation?")) return;
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('session-updated'));
        router.push('/chat');
      }
    } catch {
      // Silent — same as sidebar.
    }
  }, [sessionId, router]);

  const handleAddToSplit = useCallback(() => {
    if (!sessionId) return;
    const projectName = workingDirectory ? workingDirectory.split(/[\\/]/).filter(Boolean).pop() || '' : '';
    addToSplit({
      sessionId,
      title: sessionTitle || t('chat.newConversation'),
      workingDirectory: workingDirectory || '',
      projectName,
    });
  }, [sessionId, sessionTitle, workingDirectory, addToSplit, t]);

  const handleCopyId = useCallback(() => {
    if (!sessionId) return;
    navigator.clipboard.writeText(sessionId);
  }, [sessionId]);

  // Extract project name from working directory.
  const projectName = workingDirectory ? workingDirectory.split(/[\\/]/).filter(Boolean).pop() || '' : '';

  // The reopen button is shown only when the sidebar has been
  // collapsed by the user. It pairs with the collapse toggle inside
  // ChatListPanel — so the user can always get the sidebar back from
  // the page they're on, regardless of route.
  //
  // `mounted` gates the conditional render so SSR and the first
  // client paint produce the same tree. AppShell's matchMedia effect
  // flips chatListOpen on mount, so without this gate the button
  // would briefly appear (server: chatListOpen=false → button shown)
  // and then disappear (client effect → chatListOpen=true), tripping
  // a hydration mismatch warning.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const reopenSidebarButton = mounted && !chatListOpen ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setChatListOpen(true)}
          aria-label={t('chatList.expandSidebar' as TranslationKey)}
          className="text-muted-foreground hover:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <SidebarSimple size={16} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t('chatList.expandSidebar' as TranslationKey)}
      </TooltipContent>
    </Tooltip>
  ) : null;

  // On non-chat routes the bar is otherwise just a thin drag region.
  // We still need the reopen button visible there so the user has a
  // way back to the sidebar from /skills, /mcp, /settings, etc.
  if (!isChatRoute) {
    return (
      <div
        className="flex h-8 shrink-0 items-center pl-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {reopenSidebarButton}
      </div>
    );
  }

  const canSplit = !!sessionId && !isInSplit(sessionId);

  return (
    <>
      <div
        className="flex h-12 shrink-0 items-center gap-3 bg-background px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Reopen-sidebar toggle, only present when the user collapsed
            the left nav. Pairs with the collapse button inside
            ChatListPanel; null otherwise so it doesn't take up space. */}
        {reopenSidebarButton}
        {/* Left: chat title → workspace name (muted) → per-session "..."
            menu. The "..." mirrors the chat list's row menu so users can
            rename / split / copy id / delete the active conversation
            from inside the chat page (the inline pencil edit affordance
            was retired in favour of the unified menu). */}
        <div
          className="flex items-center gap-2 min-w-0 shrink"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {sessionTitle && (
            <h2 className="text-sm font-medium text-foreground truncate max-w-[280px]">
              {sessionTitle}
            </h2>
          )}

          {projectName && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-[200px] px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
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
                  <span className="truncate">{projectName}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs break-all">{workingDirectory}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {sessionId && (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('chatList.moreActions' as TranslationKey)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <DotsThree size={18} weight="bold" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[160px]">
                <DropdownMenuItem
                  disabled={!canSplit}
                  onClick={handleAddToSplit}
                >
                  <Columns size={14} />
                  <span>{t('chatList.splitScreen' as TranslationKey)}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setMenuOpen(false);
                    setRenameOpen(true);
                  }}
                >
                  <PencilSimple size={14} />
                  <span>{t('chatList.renameConversation' as TranslationKey)}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyId}>
                  <Copy size={14} />
                  <span>{t('chatList.copySessionId' as TranslationKey)}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                  <Trash size={14} />
                  <span>{t('chatList.deleteConversation' as TranslationKey)}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: panel toggles */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Branch label — informational only (no longer a toggle since
              Git lives inside the Workspace Sidebar). Click jumps to the
              Git Tab; the assistant-buddy avatar is gone with the same
              consolidation since Widget is now a Sidebar Tab too. */}
          {currentBranch && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    if (ws) {
                      ws.setActiveTab('git');
                    }
                  }}
                  className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <GitBranch size={16} />
                  <span className="max-w-[100px] truncate">{currentBranch}</span>
                  {gitDirtyCount > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px] text-amber-500">
                      <DotOutline size={10} weight="fill" />
                      {gitDirtyCount}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('topBar.git')}</TooltipContent>
            </Tooltip>
          )}

          {/* File tree toggle — independent topbar entry per the
              revised Phase 2 boundary (2026-04-30):
                1. File tree is a high-frequency deterministic tool, so
                   it gets its own button.
                2. Workspace Sidebar handles work surfaces (Git / Widget
                   / preview); the file tree is NOT folded into it by
                   default. Files Tab only appears when the user
                   explicitly pins.
                3. Lightweight tree + Workspace Sidebar are mutually
                   exclusive in the OPEN state — clicking the tree
                   button while the sidebar is open closes the sidebar
                   first so two right rails never squeeze chat at once. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={fileTreeOpen ? 'secondary' : 'ghost'}
                size="icon-sm"
                className={
                  fileTreeOpen ? '' : 'text-muted-foreground hover:text-foreground'
                }
                onClick={() => {
                  const next = !fileTreeOpen;
                  setFileTreeOpen(next);
                  // Mutual exclusion: opening the lightweight tree
                  // collapses the Workspace Sidebar so chat keeps
                  // breathing room. The reverse pairing lives on the
                  // sidebar toggle below.
                  if (next && ws?.state.open) ws.setOpen(false);
                }}
              >
                <TreeStructure size={16} />
                <span className="sr-only">{t('topBar.fileTree')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('topBar.fileTree')}</TooltipContent>
          </Tooltip>

          {/* Single Workspace Sidebar toggle — replaces the previous
              Git + Widget + Dashboard cluster. The new sidebar hosts
              fixed Git / Widget Tabs plus dynamic Markdown / Artifact /
              File preview Tabs (April 2026 Phase 1). */}
          {ws && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={ws.state.open ? "secondary" : "ghost"}
                  size="icon-sm"
                  className={ws.state.open ? "" : "text-muted-foreground hover:text-foreground"}
                  onClick={() => {
                    const next = !ws.state.open;
                    ws.setOpen(next);
                    // Open path: collapse the legacy lightweight file
                    // tree so the user doesn't end up with two right-
                    // rail panels stacked. (Codex P2 收口 2026-04-30.)
                    if (next && fileTreeOpen) setFileTreeOpen(false);
                  }}
                  aria-label={t('workspaceSidebar.toggle' as TranslationKey)}
                >
                  <SidebarSimple size={16} weight={ws.state.open ? 'fill' : 'regular'} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t('workspaceSidebar.toggle' as TranslationKey)}
              </TooltipContent>
            </Tooltip>
          )}

          {isWindows && <div style={{ width: 138 }} className="shrink-0" />}
        </div>
      </div>

      <PromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t('prompt.rename.title' as TranslationKey)}
        defaultValue={sessionTitle || ''}
        placeholder={t('prompt.rename.placeholder' as TranslationKey)}
        confirmLabel={t('common.confirm' as TranslationKey)}
        cancelLabel={t('common.cancel' as TranslationKey)}
        onConfirm={(value) => {
          if (value !== sessionTitle) {
            handleRename(value);
          }
        }}
      />
    </>
  );
}
