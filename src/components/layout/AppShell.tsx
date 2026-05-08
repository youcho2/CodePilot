"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
// NavRail removed — navigation merged into ChatListPanel
import { ChatListPanel } from "./ChatListPanel";
import { SettingsSidebar } from "./SettingsSidebar";
import { ResizeHandle } from "./ResizeHandle";
import { UpdateDialog } from "./UpdateDialog";
import { FeatureAnnouncementDialog } from "./FeatureAnnouncementDialog";
import { UpdateBanner } from "./UpdateBanner";
import { UnifiedTopBar } from "./UnifiedTopBar";
import { PanelZone } from "./PanelZone";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { WorkspaceSidebarProvider, useWorkspaceSidebarOptional } from "@/hooks/useWorkspaceSidebar";
import { PanelContext, usePanel, type PreviewViewMode, type PreviewSource } from "@/hooks/usePanel";
import { UpdateContext } from "@/hooks/useUpdate";
import { useUpdateChecker } from "@/hooks/useUpdateChecker";
import { BatchImageGenContext, useBatchImageGenState } from "@/hooks/useBatchImageGen";
import { SplitContext, type SplitSession } from "@/hooks/useSplit";
import { SplitChatContainer } from "./SplitChatContainer";
import { ErrorBoundary } from "./ErrorBoundary";
import { SentryInit } from "./SentryInit";
import { getActiveSessionIds, getSnapshot } from "@/lib/stream-session-manager";
import { useGitStatus } from "@/hooks/useGitStatus";
import { SetupCenter } from '@/components/setup/SetupCenter';
import { Toaster } from '@/components/ui/toast';
import { useNotificationPoll } from '@/hooks/useNotificationPoll';
import { useGlobalSearchShortcut } from '@/hooks/useGlobalSearchShortcut';
import { GlobalSearchDialog } from './GlobalSearchDialog';

const SPLIT_SESSIONS_KEY = "codepilot:split-sessions";
const SPLIT_ACTIVE_COLUMN_KEY = "codepilot:split-active-column";

function loadSplitSessions(): SplitSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SPLIT_SESSIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function saveSplitSessions(sessions: SplitSession[]) {
  if (sessions.length >= 2) {
    localStorage.setItem(SPLIT_SESSIONS_KEY, JSON.stringify(sessions));
  } else {
    localStorage.removeItem(SPLIT_SESSIONS_KEY);
    localStorage.removeItem(SPLIT_ACTIVE_COLUMN_KEY);
  }
}

function loadActiveColumn(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(SPLIT_ACTIVE_COLUMN_KEY) || "";
}

const EMPTY_SET = new Set<string>();
const CHATLIST_MIN = 180;
const CHATLIST_MAX = 300;

/**
 * Extensions that default to "rendered" view mode when a file is opened
 * via setPreviewSource / setPreviewFile. Keeping this list aligned with
 * PreviewPanel's RENDERABLE_EXTENSIONS so anything we can actually
 * render in Preview mode also lands there by default — previously .jsx
 * / .tsx fell through to Source even though Sandpack can render them,
 * which made the DiffSummary "Open preview" button surface source code
 * when the user clicked a TSX card.
 */
const RENDERED_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm", ".jsx", ".tsx", ".csv", ".tsv"]);

function defaultViewMode(filePath: string): PreviewViewMode {
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
  return RENDERED_EXTENSIONS.has(ext) ? "rendered" : "source";
}

const LG_BREAKPOINT = 1024;

/**
 * Inner row that holds the chat main area + the two right-rail
 * surfaces:
 *   - `<PanelZone>` mounts the lightweight FileTreePanel (independent
 *     topbar entry) and the AssistantPanel.
 *   - `<WorkspaceSidebar>` mounts the unified Tab shell that owns
 *     Git / Widget / Markdown / Artifact / file preview Tabs.
 *
 * Reads PanelContext + WorkspaceSidebarContext to derive whether any
 * rail is visible and toggles a top border accordingly:
 *   - file tree open OR sidebar open → border-t between topbar chrome
 *     and the work area
 *   - both collapsed → no border (chat reads uncluttered)
 *
 * Mutual exclusion (file tree vs sidebar) is enforced at the topbar
 * onClick handlers, not here — this row trusts the panel state.
 */
function ChatContentRow({
  isChatDetailRoute,
  isSplitActive,
  children,
}: {
  isChatDetailRoute: boolean;
  isSplitActive: boolean;
  children: React.ReactNode;
}) {
  const { fileTreeOpen } = usePanel();
  const ws = useWorkspaceSidebarOptional();
  const railVisible = isChatDetailRoute && (fileTreeOpen || (ws?.state.open ?? false));
  return (
    <div
      className={`flex flex-1 min-h-0 overflow-hidden ${railVisible ? 'border-t border-border/40' : ''}`}
    >
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="relative flex-1 overflow-hidden">
          {isSplitActive ? (
            <SplitChatContainer />
          ) : (
            <ErrorBoundary>{children}</ErrorBoundary>
          )}
        </main>
      </div>
      {/* Right rail composition (post-Phase 2, 2026-04-30):
          - WorkspaceSidebar = unified Tab shell. Fixed Git / Widget
            Tabs, plus dynamic Markdown / Artifact / file preview
            Tabs created by the chat / file tree click paths. Toggled
            from the topbar `SidebarSimple` button.
          - PanelZone = light right rail with FileTreePanel +
            AssistantPanel. The Git / Widget / Preview channels were
            removed when those surfaces moved into the sidebar; the
            file tree intentionally remained here as an independent
            high-frequency entry per the Phase 2 product boundary.
          The two are mutually exclusive in the OPEN state — the
          topbar handlers close one when the other opens. */}
      {isChatDetailRoute && <WorkspaceSidebar />}
      {isChatDetailRoute && <PanelZone />}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [chatListOpenRaw, setChatListOpenRaw] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupInitialCard, setSetupInitialCard] = useState<'claude' | 'provider' | 'project' | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);

  useGlobalSearchShortcut(() => setSearchOpen(true));

  // Record the last non-settings pathname for SettingsSidebar's Back button.
  // Without this, deep-linking into /settings#providers and pressing Back
  // would call router.back() and escape the app (e.g. to about:blank).
  // sessionStorage scopes per-tab so it doesn't leak across windows.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!pathname.startsWith('/settings')) {
      const fullPath = pathname + window.location.search + window.location.hash;
      sessionStorage.setItem('codepilot:last-non-settings-path', fullPath);
    }
  }, [pathname]);

  // Poll server-side notification queue and display as toasts
  useNotificationPoll();

  // Check if setup is needed
  useEffect(() => {
    fetch('/api/setup')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && !data.completed) {
          setSetupOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  // Listen for open-setup-center events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setSetupInitialCard(detail?.initialCard);
      setSetupOpen(true);
    };
    window.addEventListener('open-setup-center', handler);
    return () => window.removeEventListener('open-setup-center', handler);
  }, []);

  // Hash bridge: error messages render `[Open Settings](/settings#providers)`
  // markdown links as fallback when the frontend cannot directly dispatch the
  // open-setup-center event (e.g. rendering inside the SSE text stream). When
  // such a link is clicked the hash changes to `#providers`, and we surface
  // the SetupCenter Provider card here — EXCEPT on /settings itself, where
  // SettingsLayout owns the #providers hash for its own section routing
  // (see SettingsLayout.tsx `getSectionFromHash`). If we swallowed the hash
  // there, clicking "Add Provider" inside SetupCenter would ping-pong the
  // user back into SetupCenter instead of reaching the providers tab.
  useEffect(() => {
    const maybeOpenFromHash = () => {
      if (typeof window === 'undefined') return;
      if (window.location.pathname === '/settings') return;
      if (window.location.hash === '#providers') {
        setSetupInitialCard('provider');
        setSetupOpen(true);
        // Clear the hash so a second navigation to /#providers fires again.
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
    maybeOpenFromHash();
    window.addEventListener('hashchange', maybeOpenFromHash);
    return () => window.removeEventListener('hashchange', maybeOpenFromHash);
  }, []);

  // Listen for open-global-search events from ChatListPanel
  useEffect(() => {
    const handler = () => setSearchOpen(true);
    window.addEventListener('open-global-search', handler);
    return () => window.removeEventListener('open-global-search', handler);
  }, []);

  // Sync with viewport after hydration to avoid SSR mismatch
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setChatListOpenRaw(window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`).matches);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Panel width state with localStorage persistence
  const [chatListWidth, setChatListWidth] = useState(240);

  // Restore persisted width after hydration
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = localStorage.getItem("codepilot_chatlist_width");
    if (saved) setChatListWidth(parseInt(saved));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleChatListResize = useCallback((delta: number) => {
    setChatListWidth((w) => Math.min(CHATLIST_MAX, Math.max(CHATLIST_MIN, w + delta)));
  }, []);
  const handleChatListResizeEnd = useCallback(() => {
    setChatListWidth((w) => {
      localStorage.setItem("codepilot_chatlist_width", String(w));
      return w;
    });
  }, []);

  // Panel state — chatListOpen is no longer gated by route (sidebar always visible)
  const isChatRoute = pathname.startsWith("/chat/") || pathname === "/chat";
  const chatListOpen = chatListOpenRaw;

  const setChatListOpen = useCallback((open: boolean) => {
    setChatListOpenRaw(open);
  }, []);

  // --- Right-rail panel states ---
  // Phase 2 (2026-04-30): gitPanelOpen / dashboardPanelOpen / previewOpen
  // were removed — those surfaces moved into the Workspace Sidebar
  // (Git + Widget fixed Tabs, Markdown / Artifact / file preview as
  // dynamic Tabs). Only fileTreeOpen remains as the lightweight
  // independent topbar entry, plus assistantPanelOpen which doesn't
  // fit the AI-work-surface Tab model.
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(false);
  const [isAssistantWorkspace, setIsAssistantWorkspace] = useState(false);

  // --- Git summary (derived from polling hook, no setState needed) ---
  const [currentWorktreeLabel, setCurrentWorktreeLabel] = useState("");

  const [workingDirectory, setWorkingDirectory] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [pendingApprovalSessionId, setPendingApprovalSessionId] = useState("");

  const { status: gitStatusFromHook } = useGitStatus(workingDirectory);
  const currentBranch = gitStatusFromHook?.branch ?? "";
  const gitDirtyCount = gitStatusFromHook?.changedFiles.filter(f => f.status !== 'untracked').length ?? 0;

  // --- Multi-session stream tracking (driven by stream-session-manager) ---
  const [activeStreamingSessions, setActiveStreamingSessions] = useState<Set<string>>(EMPTY_SET);
  const [pendingApprovalSessionIds, setPendingApprovalSessionIds] = useState<Set<string>>(EMPTY_SET);

  // Listen for global stream events from stream-session-manager
  useEffect(() => {
    const handler = () => {
      const activeIds = getActiveSessionIds();
      setActiveStreamingSessions(activeIds.length > 0 ? new Set(activeIds) : EMPTY_SET);

      const approvals = new Set<string>();
      for (const sid of activeIds) {
        const snap = getSnapshot(sid);
        if (snap?.pendingPermission && !snap.permissionResolved) {
          approvals.add(sid);
        }
      }
      setPendingApprovalSessionIds(approvals.size > 0 ? approvals : EMPTY_SET);
    };
    window.addEventListener('stream-session-event', handler);
    return () => window.removeEventListener('stream-session-event', handler);
  }, []);

  // --- Split-screen state ---
  const [splitSessions, setSplitSessions] = useState<SplitSession[]>(() => loadSplitSessions());
  const [activeColumnId, setActiveColumnIdRaw] = useState<string>(() => loadActiveColumn());
  const isSplitActive = splitSessions.length >= 2;
  const isChatDetailRoute = pathname.startsWith("/chat/") || isSplitActive;

  // Persist split sessions to localStorage
  useEffect(() => {
    saveSplitSessions(splitSessions);
    if (activeColumnId) {
      localStorage.setItem(SPLIT_ACTIVE_COLUMN_KEY, activeColumnId);
    }
  }, [splitSessions, activeColumnId]);

  // URL sync: when activeColumn changes, update router
  useEffect(() => {
    if (isSplitActive && activeColumnId) {
      const target = `/chat/${activeColumnId}`;
      if (pathname !== target) {
        router.replace(target);
      }
    }
  }, [isSplitActive, activeColumnId, pathname, router]);

  const setActiveColumn = useCallback((sessionId: string) => {
    setActiveColumnIdRaw(sessionId);
  }, []);

  const addToSplit = useCallback((session: SplitSession) => {
    setSplitSessions((prev) => {
      if (prev.some((s) => s.sessionId === session.sessionId)) return prev;

      if (prev.length < 2) {
        const currentSessionId = sessionId;
        if (currentSessionId && currentSessionId !== session.sessionId) {
          const currentSession: SplitSession = {
            sessionId: currentSessionId,
            title: sessionTitle || "New Conversation",
            workingDirectory: workingDirectory || "",
            projectName: "",
            mode: "code",
          };
          const hasCurrentAlready = prev.some((s) => s.sessionId === currentSessionId);
          const next = hasCurrentAlready ? [...prev, session] : [...prev, currentSession, session];
          setActiveColumnIdRaw(session.sessionId);
          return next;
        }
      }

      const next = [...prev, session];
      setActiveColumnIdRaw(session.sessionId);
      return next;
    });
  }, [sessionId, sessionTitle, workingDirectory]);

  const pendingNavigateRef = useRef<string | null>(null);

  const removeFromSplit = useCallback((removeId: string) => {
    setSplitSessions((prev) => {
      const next = prev.filter((s) => s.sessionId !== removeId);
      if (next.length <= 1) {
        if (next.length === 1) {
          pendingNavigateRef.current = next[0].sessionId;
        }
        return [];
      }
      setActiveColumnIdRaw((currentActive) =>
        currentActive === removeId ? next[0].sessionId : currentActive
      );
      return next;
    });
  }, []);

  useEffect(() => {
    if (pendingNavigateRef.current) {
      const target = pendingNavigateRef.current;
      pendingNavigateRef.current = null;
      router.replace(`/chat/${target}`);
    }
  }, [splitSessions, router]);

  const exitSplit = useCallback(() => {
    const firstSession = splitSessions[0];
    setSplitSessions([]);
    setActiveColumnIdRaw("");
    if (firstSession) {
      router.replace(`/chat/${firstSession.sessionId}`);
    }
  }, [splitSessions, router]);

  const isInSplit = useCallback((sid: string) => {
    return splitSessions.some((s) => s.sessionId === sid);
  }, [splitSessions]);

  useEffect(() => {
    const handler = () => {
      setSplitSessions((prev) => prev);
    };
    window.addEventListener("session-deleted", handler);
    return () => window.removeEventListener("session-deleted", handler);
  }, []);

  useEffect(() => {
    if (isSplitActive && !pathname.startsWith("/chat")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSplitSessions([]);
      setActiveColumnIdRaw("");
    }
  }, [pathname, isSplitActive]);

  const splitContextValue = useMemo(
    () => ({
      splitSessions,
      activeColumnId,
      isSplitActive,
      addToSplit,
      removeFromSplit,
      setActiveColumn,
      exitSplit,
      isInSplit,
    }),
    [splitSessions, activeColumnId, isSplitActive, addToSplit, removeFromSplit, setActiveColumn, exitSplit, isInSplit]
  );

  // Warn before closing window/tab while any session is streaming
  useEffect(() => {
    if (activeStreamingSessions.size === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeStreamingSessions]);

  // --- Doc Preview state ---
  // `previewSource` is the discriminated union (file / inline-html /
  // inline-jsx / inline-datatable) that the WorkspaceSidebar's
  // dynamic-Tab content reads. `previewFile` is a derived path-only
  // view for code paths (FileTreePanel toggle logic, etc.) that only
  // care about the file kind — when the active source is inline-*,
  // `previewFile` is null.
  const [previewSource, setPreviewSourceRaw] = useState<PreviewSource | null>(null);
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>("source");

  const previewFile: string | null =
    previewSource?.kind === "file" ? previewSource.filePath : null;

  const setPreviewSource = useCallback((source: PreviewSource | null) => {
    setPreviewSourceRaw(source);
    if (!source) return;
    // File sources respect the extension-based default view mode.
    // Inline sources are always "rendered" — there's no raw path to show
    // for source view, and all inline variants are meaningful only rendered.
    if (source.kind === "file") {
      setPreviewViewMode(defaultViewMode(source.filePath));
    } else {
      setPreviewViewMode("rendered");
    }
    // Right-rail routing: on chat-detail routes we dispatch a
    // `workspace-tab-open-request` event so the WorkspaceSidebar
    // creates / focuses the matching dynamic Tab. Non-chat-detail
    // routes (settings, skills, plugins, etc.) don't mount the
    // sidebar at all; the source sits in context unused, which is
    // intentional — there is no preview panel outside chat-detail.
    if (isChatDetailRoute && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("workspace-tab-open-request", { detail: { source } }),
      );
    }
  }, [isChatDetailRoute]);

  const setPreviewFile = useCallback(
    (path: string | null) => {
      if (path === null) {
        setPreviewSource(null);
      } else {
        setPreviewSource({ kind: "file", filePath: path });
      }
    },
    [setPreviewSource],
  );

  // Reset doc preview when navigating between pages/sessions
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPreviewSourceRaw(null);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep chat list state in sync when resizing across the breakpoint
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => setChatListOpenRaw(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);


  // --- Skip-permissions indicator ---
  const [skipPermissionsActive, setSkipPermissionsActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const doFetch = async () => {
      try {
        const res = await fetch("/api/settings/app");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSkipPermissionsActive(data.settings?.dangerously_skip_permissions === "true");
        }
      } catch { /* ignore */ }
    };
    doFetch();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") doFetch();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", doFetch);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", doFetch);
    };
  }, []);

  // --- Update checker (native Electron + browser fallback) ---
  const updateContextValue = useUpdateChecker();

  const panelContextValue = useMemo(
    () => ({
      chatListOpen,
      setChatListOpen,
      fileTreeOpen,
      setFileTreeOpen,
      terminalOpen,
      setTerminalOpen,
      assistantPanelOpen,
      setAssistantPanelOpen,
      isAssistantWorkspace,
      setIsAssistantWorkspace,
      currentBranch,
      gitDirtyCount,
      currentWorktreeLabel,
      setCurrentWorktreeLabel,
      workingDirectory,
      setWorkingDirectory,
      sessionId,
      setSessionId,
      sessionTitle,
      setSessionTitle,
      streamingSessionId,
      setStreamingSessionId,
      pendingApprovalSessionId,
      setPendingApprovalSessionId,
      activeStreamingSessions,
      pendingApprovalSessionIds,
      previewSource,
      setPreviewSource,
      previewFile,
      setPreviewFile,
      previewViewMode,
      setPreviewViewMode,
    }),
    [chatListOpen, setChatListOpen, fileTreeOpen, terminalOpen, assistantPanelOpen, isAssistantWorkspace, currentBranch, gitDirtyCount, currentWorktreeLabel, workingDirectory, sessionId, sessionTitle, streamingSessionId, pendingApprovalSessionId, activeStreamingSessions, pendingApprovalSessionIds, previewSource, setPreviewSource, previewFile, setPreviewFile, previewViewMode]
  );

  const batchImageGenValue = useBatchImageGenState();

  return (
    <UpdateContext.Provider value={updateContextValue}>
      <SentryInit />
      <PanelContext.Provider value={panelContextValue}>
        <WorkspaceSidebarProvider workingDirectory={workingDirectory} sessionId={sessionId}>
        <SplitContext.Provider value={splitContextValue}>
        <BatchImageGenContext.Provider value={batchImageGenValue}>
        <TooltipProvider delayDuration={300}>
          <div className="flex h-screen overflow-hidden">
            <ErrorBoundary>
              {pathname.startsWith('/settings') ? (
                <SettingsSidebar open={chatListOpen} width={chatListWidth} />
              ) : (
                <ChatListPanel
                  open={chatListOpen}
                  width={chatListWidth}
                  hasUpdate={updateContextValue.updateInfo?.updateAvailable ?? false}
                  readyToInstall={updateContextValue.updateInfo?.readyToInstall ?? false}
                />
              )}
            </ErrorBoundary>
            {chatListOpen && (
              <ResizeHandle side="left" onResize={handleChatListResize} onResizeEnd={handleChatListResizeEnd} />
            )}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <UnifiedTopBar />
              <UpdateBanner />
              <ChatContentRow isChatDetailRoute={isChatDetailRoute} isSplitActive={isSplitActive}>
                {children}
              </ChatContentRow>
            </div>
          </div>
          <UpdateDialog />
          <FeatureAnnouncementDialog />
          <Toaster />
          <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
          {setupOpen && (
            <SetupCenter
              onClose={() => setSetupOpen(false)}
              initialCard={setupInitialCard}
            />
          )}
        </TooltipProvider>
        </BatchImageGenContext.Provider>
        </SplitContext.Provider>
        </WorkspaceSidebarProvider>
      </PanelContext.Provider>
    </UpdateContext.Provider>
  );
}
