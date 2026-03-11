"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getLocalDateString } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SpinnerGap, CheckCircle, X } from "@phosphor-icons/react";
import { useTranslation } from "@/hooks/useTranslation";
import type { WorkspaceInspectResult } from "@/types";

interface FileStatus {
  exists: boolean;
  chars: number;
  preview: string;
}

interface WorkspaceState {
  onboardingComplete: boolean;
  lastCheckInDate: string | null;
  schemaVersion: number;
}

interface TaxonomyCategoryInfo {
  id: string;
  label: string;
  role: string;
  confidence: number;
  source: string;
  paths: string[];
}

interface IndexStats {
  fileCount: number;
  chunkCount: number;
  lastIndexed: number;
  staleCount: number;
}

interface WorkspaceInfo {
  path: string | null;
  valid?: boolean;
  reason?: string;
  exists?: boolean;
  files: Record<string, FileStatus>;
  state: WorkspaceState | null;
}

const FILE_LABELS: Record<string, string> = {
  claude: "claude.md",
  soul: "soul.md",
  user: "user.md",
  memory: "memory.md",
};

type TabId = 'files' | 'taxonomy' | 'index' | 'organize';

type PathValidationStatus = 'idle' | 'checking' | 'valid' | 'invalid';

type ConfirmDialogType =
  | { kind: 'not_found' }
  | { kind: 'empty' }
  | { kind: 'normal_directory' }
  | { kind: 'existing_workspace'; summary: NonNullable<WorkspaceInspectResult['summary']> }
  | { kind: 'partial_workspace' };

export function AssistantWorkspaceSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [refreshingDocs, setRefreshingDocs] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('files');
  const [taxonomy, setTaxonomy] = useState<TaxonomyCategoryInfo[]>([]);
  const [indexStats, setIndexStats] = useState<IndexStats | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Path validation state
  const [pathValidation, setPathValidation] = useState<PathValidationStatus>('idle');
  const [pathError, setPathError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogType | null>(null);
  const [inspecting, setInspecting] = useState(false);

  const fetchWorkspace = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/workspace");
      if (res.ok) {
        const data = await res.json();
        setWorkspace(data);
        if (data.path) setPathInput(data.path);
      }
    } catch (e) {
      console.error("Failed to fetch workspace:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTaxonomy = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/workspace");
      if (res.ok) {
        const data = await res.json();
        if (data.taxonomy) setTaxonomy(data.taxonomy);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchIndexStats = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace/index");
      if (res.ok) {
        const data = await res.json();
        setIndexStats(data);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  useEffect(() => {
    if (workspace?.path && activeTab === 'taxonomy') fetchTaxonomy();
    if (workspace?.path && activeTab === 'index') fetchIndexStats();
  }, [workspace?.path, activeTab, fetchTaxonomy, fetchIndexStats]);

  // Debounced path validation
  const validatePath = useCallback((path: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPathError(null);

    if (!path.trim()) {
      setPathValidation('idle');
      return;
    }

    setPathValidation('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/workspace/inspect?path=${encodeURIComponent(path.trim())}`);
        if (!res.ok) {
          setPathValidation('invalid');
          setPathError(t('assistant.inspectFailed'));
          return;
        }
        const data: WorkspaceInspectResult = await res.json();
        if (!data.exists) {
          // Non-existent path is allowed — user can create it via initialize
          setPathValidation('valid');
        } else if (!data.isDirectory) {
          setPathValidation('invalid');
          setPathError(t('assistant.pathNotDirectory'));
        } else if (!data.readable) {
          setPathValidation('invalid');
          setPathError(t('assistant.pathNotReadable'));
        } else if (!data.writable) {
          setPathValidation('invalid');
          setPathError(t('assistant.pathNotWritable'));
        } else {
          setPathValidation('valid');
        }
      } catch {
        setPathValidation('invalid');
        setPathError(t('assistant.inspectFailed'));
      }
    }, 500);
  }, [t]);

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handlePathInputChange = useCallback((value: string) => {
    setPathInput(value);
    validatePath(value);
  }, [validatePath]);

  // Execute the actual save + optional auto-navigate
  // navigateMode: 'new' = always create new session, 'reuse' = try to reuse latest session
  const executeSave = useCallback(async (initialize: boolean, resetOnboarding?: boolean, navigateMode: 'new' | 'reuse' = 'new') => {
    if (!pathInput.trim()) return;
    const oldPath = workspace?.path || null;
    const newPath = pathInput.trim();
    if (initialize) setInitializing(true);
    try {
      const body: Record<string, unknown> = { path: newPath, initialize };
      if (resetOnboarding) body.resetOnboarding = true;
      const res = await fetch("/api/settings/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await fetchWorkspace();

        // If path actually changed, dispatch event
        if (oldPath && oldPath !== newPath) {
          window.dispatchEvent(new CustomEvent('assistant-workspace-switched', {
            detail: { oldPath, newPath },
          }));
        }

        // Navigate to assistant session
        try {
          const model = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') || '' : '';
          const provider_id = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') || '' : '';
          const sessionMode = navigateMode === 'reuse' ? 'checkin' : 'onboarding';
          const sessionRes = await fetch("/api/workspace/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: sessionMode, model, provider_id }),
          });
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            window.dispatchEvent(new CustomEvent("session-created"));
            router.push(`/chat/${sessionData.session.id}`);
          }
        } catch (navErr) {
          console.error("Failed to auto-navigate to session:", navErr);
        }
      }
    } catch (e) {
      console.error("Failed to save workspace path:", e);
    } finally {
      setInitializing(false);
      setConfirmDialog(null);
    }
  }, [pathInput, fetchWorkspace, workspace?.path, router]);

  // Inspect path and show confirmation dialog (or save directly if path unchanged)
  const handleSaveClick = useCallback(async () => {
    if (!pathInput.trim()) return;

    // If path hasn't changed, no-op
    if (pathInput.trim() === workspace?.path) {
      return;
    }

    setInspecting(true);
    try {
      const res = await fetch(`/api/workspace/inspect?path=${encodeURIComponent(pathInput.trim())}`);
      if (!res.ok) {
        setPathValidation('invalid');
        setPathError(t('assistant.inspectFailed'));
        return;
      }
      const data: WorkspaceInspectResult = await res.json();

      // Non-existent path — offer to create it
      if (!data.exists) {
        setConfirmDialog({ kind: 'not_found' });
        return;
      }
      // Check for invalid states — show error, block save
      if (!data.isDirectory) {
        setPathValidation('invalid');
        setPathError(t('assistant.pathNotDirectory'));
        return;
      }
      if (!data.readable) {
        setPathValidation('invalid');
        setPathError(t('assistant.pathNotReadable'));
        return;
      }
      if (!data.writable) {
        setPathValidation('invalid');
        setPathError(t('assistant.pathNotWritable'));
        return;
      }

      // Show confirmation dialog based on workspace status
      switch (data.workspaceStatus) {
        case 'empty':
          setConfirmDialog({ kind: 'empty' });
          break;
        case 'normal_directory':
          setConfirmDialog({ kind: 'normal_directory' });
          break;
        case 'existing_workspace':
          setConfirmDialog({
            kind: 'existing_workspace',
            summary: data.summary || { onboardingComplete: false, lastCheckInDate: null, fileCount: 0 },
          });
          break;
        case 'partial_workspace':
          setConfirmDialog({ kind: 'partial_workspace' });
          break;
        default:
          setPathValidation('invalid');
          setPathError(t('assistant.pathInvalid'));
      }
    } catch (e) {
      console.error("Failed to inspect workspace:", e);
      setPathValidation('invalid');
      setPathError(t('assistant.inspectFailed'));
    } finally {
      setInspecting(false);
    }
  }, [pathInput, workspace?.path, executeSave, t]);

  const handleSelectFolder = useCallback(async () => {
    try {
      if (window.electronAPI?.dialog?.openFolder) {
        const result = await window.electronAPI.dialog.openFolder({ title: t('assistant.selectFolder') });
        if (!result.canceled && result.filePaths[0]) {
          setPathInput(result.filePaths[0]);
          validatePath(result.filePaths[0]);
        }
      } else {
        const input = prompt("Enter workspace directory path:");
        if (input) {
          setPathInput(input);
          validatePath(input);
        }
      }
    } catch (e) {
      console.error("Failed to select folder:", e);
    }
  }, [validatePath, t]);

  const handleRefreshDocs = useCallback(async () => {
    setRefreshingDocs(true);
    try {
      await fetch("/api/workspace/docs", { method: "POST" });
    } catch (e) {
      console.error("Failed to refresh docs:", e);
    } finally {
      setRefreshingDocs(false);
    }
  }, []);

  const handleStartOnboarding = useCallback(async () => {
    if (!workspace?.path) return;
    setCreatingSession(true);
    try {
      const model = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') || '' : '';
      const provider_id = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') || '' : '';
      const res = await fetch("/api/workspace/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: 'onboarding', model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent("session-created"));
        router.push(`/chat/${data.session.id}`);
      }
    } catch (e) {
      console.error("Failed to create onboarding session:", e);
    } finally {
      setCreatingSession(false);
    }
  }, [workspace?.path, router]);

  const handleStartCheckIn = useCallback(async () => {
    if (!workspace?.path) return;
    setCreatingSession(true);
    try {
      const model = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') || '' : '';
      const provider_id = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') || '' : '';
      const res = await fetch("/api/workspace/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: 'checkin', model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent("session-created"));
        router.push(`/chat/${data.session.id}`);
      }
    } catch (e) {
      console.error("Failed to create check-in session:", e);
    } finally {
      setCreatingSession(false);
    }
  }, [workspace?.path, router]);

  const handleReindex = useCallback(async () => {
    setReindexing(true);
    try {
      await fetch("/api/workspace/index", { method: "POST" });
      await fetchIndexStats();
    } catch (e) {
      console.error("Failed to reindex:", e);
    } finally {
      setReindexing(false);
    }
  }, [fetchIndexStats]);

  const handleArchive = useCallback(async () => {
    setArchiving(true);
    try {
      await fetch("/api/workspace/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: 'archive' }),
      });
    } catch (e) {
      console.error("Failed to archive:", e);
    } finally {
      setArchiving(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const today = getLocalDateString();
  const checkInDoneToday = workspace?.state?.lastCheckInDate === today;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'files', label: t('assistant.fileStatus') },
    { id: 'taxonomy', label: t('assistant.taxonomyTitle') },
    { id: 'index', label: t('assistant.indexTitle') },
    { id: 'organize', label: t('assistant.organizeTitle') },
  ];

  // Render path validation indicator
  const renderValidationIcon = () => {
    switch (pathValidation) {
      case 'checking':
        return <SpinnerGap size={16} className="animate-spin text-muted-foreground" />;
      case 'valid':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'invalid':
        return <X size={16} className="text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Workspace Path Card */}
      <div className="rounded-lg border border-border/50 p-4">
        <h2 className="text-sm font-medium">{t('assistant.workspacePath')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('assistant.workspacePathHint')}</p>
        <div className="flex items-center gap-2 mt-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={pathInput}
              onChange={(e) => handlePathInputChange(e.target.value)}
              placeholder="/path/to/workspace"
              className="w-full rounded-md border border-border/50 bg-background px-3 py-1.5 text-sm pr-8"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              {renderValidationIcon()}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleSelectFolder}>
            {t('assistant.selectFolder')}
          </Button>
        </div>
        {pathError && (
          <p className="text-xs text-red-500 mt-1">{pathError}</p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <Button
            size="sm"
            onClick={handleSaveClick}
            disabled={!pathInput.trim() || inspecting || pathValidation === 'invalid'}
          >
            {inspecting ? (
              <>
                <SpinnerGap size={14} className="animate-spin mr-1" />
                {t('assistant.inspecting')}
              </>
            ) : (
              t('common.save')
            )}
          </Button>
        </div>
      </div>

      {/* Invalid workspace path warning */}
      {workspace?.path && workspace.valid === false && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-4">
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('assistant.workspaceInvalid')}: {workspace.reason === 'path_not_found'
              ? t('assistant.pathNotExist')
              : workspace.reason === 'not_a_directory'
              ? t('assistant.pathNotDirectory')
              : workspace.reason === 'not_readable'
              ? t('assistant.pathNotReadable')
              : workspace.reason === 'not_writable'
              ? t('assistant.pathNotWritable')
              : t('assistant.pathInvalid')
            }
          </p>
        </div>
      )}

      {/* Onboarding Status Card */}
      {workspace?.path && workspace.valid !== false && (
        <div className="rounded-lg border border-border/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">{t('assistant.onboardingTitle')}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t('assistant.onboardingDesc')}</p>
              <p className="text-xs mt-1">
                {workspace.state?.onboardingComplete
                  ? <span className="text-green-600">{t('assistant.onboardingComplete')}</span>
                  : <span className="text-yellow-600">{t('assistant.onboardingNotStarted')}</span>
                }
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartOnboarding}
              disabled={creatingSession}
            >
              {creatingSession ? (
                <SpinnerGap size={14} className="animate-spin" />
              ) : workspace.state?.onboardingComplete
                ? t('assistant.redoOnboarding')
                : t('assistant.startOnboarding')
              }
            </Button>
          </div>
        </div>
      )}

      {/* Daily Check-in Card — only shown when onboarding is complete */}
      {workspace?.path && workspace.valid !== false && workspace.state?.onboardingComplete && (
        <div className="rounded-lg border border-border/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">{t('assistant.checkInTitle')}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t('assistant.checkInDesc')}</p>
              <p className="text-xs mt-1">
                {workspace.state?.lastCheckInDate && (
                  <span className="text-muted-foreground">
                    {t('assistant.lastCheckIn')}: {workspace.state.lastCheckInDate}
                  </span>
                )}
                {" "}
                {checkInDoneToday
                  ? <span className="text-green-600">{t('assistant.checkInToday')}</span>
                  : <span className="text-yellow-600">{t('assistant.checkInNeeded')}</span>
                }
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartCheckIn}
              disabled={creatingSession}
            >
              {creatingSession ? (
                <SpinnerGap size={14} className="animate-spin" />
              ) : (
                t('assistant.startCheckIn')
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Tabbed Section: Files / Taxonomy / Index / Organize */}
      {workspace?.path && workspace.valid !== false && (
        <div className="rounded-lg border border-border/50 p-4">
          <div className="flex gap-1 border-b border-border/50 mb-3">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                  activeTab === tab.id
                    ? 'bg-background text-foreground border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Files Tab */}
          {activeTab === 'files' && (
            <div className="space-y-2">
              {Object.entries(FILE_LABELS).map(([key, label]) => {
                const file = workspace.files[key];
                return (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs">{label}</span>
                    <div className="flex items-center gap-2">
                      {file?.exists ? (
                        <>
                          <span className="text-xs text-muted-foreground">
                            {t('assistant.fileChars', { count: String(file.chars) })}
                          </span>
                          <span className="h-2 w-2 rounded-full bg-green-500" />
                          <span className="text-xs text-green-600">{t('assistant.fileExists')}</span>
                        </>
                      ) : (
                        <>
                          <span className="h-2 w-2 rounded-full bg-yellow-500" />
                          <span className="text-xs text-yellow-600">{t('assistant.fileMissing')}</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-end mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshDocs}
                  disabled={refreshingDocs}
                >
                  {refreshingDocs ? (
                    <>
                      <SpinnerGap size={14} className="animate-spin mr-1" />
                      {t('assistant.refreshingDocs')}
                    </>
                  ) : (
                    t('assistant.refreshDocs')
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Taxonomy Tab */}
          {activeTab === 'taxonomy' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('assistant.taxonomyDesc')}</p>
              {taxonomy.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">{t('assistant.taxonomyEmpty')}</p>
              ) : (
                <div className="space-y-1.5">
                  {taxonomy.map(cat => (
                    <div key={cat.id} className="flex items-center justify-between text-xs border border-border/30 rounded px-2 py-1.5">
                      <div>
                        <span className="font-medium">{cat.label}</span>
                        <span className="text-muted-foreground ml-2">{t('assistant.taxonomyRole')}: {cat.role}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{t('assistant.taxonomySource')}: {cat.source}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          cat.confidence > 0.7 ? 'bg-green-500/10 text-green-600' :
                          cat.confidence > 0.4 ? 'bg-yellow-500/10 text-yellow-600' :
                          'bg-red-500/10 text-red-600'
                        }`}>
                          {Math.round(cat.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Index Tab */}
          {activeTab === 'index' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('assistant.indexDesc')}</p>
              {indexStats ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="border border-border/30 rounded px-2 py-1.5">
                    <span className="text-muted-foreground">{t('assistant.indexFiles', { count: String(indexStats.fileCount) })}</span>
                  </div>
                  <div className="border border-border/30 rounded px-2 py-1.5">
                    <span className="text-muted-foreground">{t('assistant.indexChunks', { count: String(indexStats.chunkCount) })}</span>
                  </div>
                  <div className="border border-border/30 rounded px-2 py-1.5">
                    <span className="text-muted-foreground">{t('assistant.indexStale', { count: String(indexStats.staleCount) })}</span>
                  </div>
                  <div className="border border-border/30 rounded px-2 py-1.5">
                    <span className="text-muted-foreground">
                      {t('assistant.indexLastIndexed')}: {indexStats.lastIndexed ? new Date(indexStats.lastIndexed).toLocaleString() : 'never'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">{t('common.loading')}</p>
              )}
              <div className="flex items-center justify-end mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReindex}
                  disabled={reindexing}
                >
                  {reindexing ? (
                    <>
                      <SpinnerGap size={14} className="animate-spin mr-1" />
                      {t('assistant.indexReindexing')}
                    </>
                  ) : (
                    t('assistant.indexReindex')
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Organize Tab */}
          {activeTab === 'organize' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('assistant.organizeDesc')}</p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleArchive}
                  disabled={archiving}
                >
                  {archiving ? (
                    <>
                      <SpinnerGap size={14} className="animate-spin mr-1" />
                      {t('assistant.organizeArchiving')}
                    </>
                  ) : (
                    t('assistant.organizeArchive')
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Confirmation Dialogs ── */}

      {/* Non-existent path — offer to create */}
      <AlertDialog open={confirmDialog?.kind === 'not_found'} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assistant.confirmNotFoundTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('assistant.confirmNotFoundDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => executeSave(true)} disabled={initializing}>
              {initializing ? (
                <>
                  <SpinnerGap size={14} className="animate-spin mr-1" />
                  {t('assistant.initializing')}
                </>
              ) : (
                t('assistant.confirmCreate')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Empty directory confirmation */}
      <AlertDialog open={confirmDialog?.kind === 'empty'} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assistant.confirmEmptyTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('assistant.confirmEmptyDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => executeSave(true)} disabled={initializing}>
              {initializing ? (
                <>
                  <SpinnerGap size={14} className="animate-spin mr-1" />
                  {t('assistant.initializing')}
                </>
              ) : (
                t('assistant.confirmInitialize')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Normal directory confirmation */}
      <AlertDialog open={confirmDialog?.kind === 'normal_directory'} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assistant.confirmNormalTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{t('assistant.confirmNormalDesc')}</p>
                <p className="text-xs text-muted-foreground">{t('assistant.confirmNormalHint')}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => executeSave(true)} disabled={initializing}>
              {initializing ? (
                <>
                  <SpinnerGap size={14} className="animate-spin mr-1" />
                  {t('assistant.initializing')}
                </>
              ) : (
                t('assistant.confirmInitialize')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Existing workspace confirmation */}
      <AlertDialog open={confirmDialog?.kind === 'existing_workspace'} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assistant.confirmExistingTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{t('assistant.confirmExistingDesc')}</p>
                {confirmDialog?.kind === 'existing_workspace' && (
                  <div className="rounded border border-border/50 p-3 space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('assistant.summaryOnboarding')}:</span>
                      <span>{confirmDialog.summary.onboardingComplete
                        ? t('assistant.onboardingComplete')
                        : t('assistant.onboardingNotStarted')
                      }</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('assistant.summaryLastCheckIn')}:</span>
                      <span>{confirmDialog.summary.lastCheckInDate || t('assistant.summaryNever')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('assistant.summaryFileCount')}:</span>
                      <span>{confirmDialog.summary.fileCount}</span>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-col gap-2">
            <Button size="sm" onClick={() => executeSave(false, false, 'reuse')} disabled={initializing}>
              {t('assistant.takeoverContinue')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => executeSave(false, true, 'new')} disabled={initializing}>
              {initializing ? (
                <>
                  <SpinnerGap size={14} className="animate-spin mr-1" />
                  {t('assistant.initializing')}
                </>
              ) : (
                t('assistant.takeoverReonboard')
              )}
            </Button>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Partial workspace confirmation */}
      <AlertDialog open={confirmDialog?.kind === 'partial_workspace'} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assistant.confirmPartialTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('assistant.confirmPartialDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => executeSave(true)} disabled={initializing}>
              {initializing ? (
                <>
                  <SpinnerGap size={14} className="animate-spin mr-1" />
                  {t('assistant.initializing')}
                </>
              ) : (
                t('assistant.confirmRepair')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
