"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";

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

interface WorkspaceInfo {
  path: string | null;
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

export function AssistantWorkspaceSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [refreshingDocs, setRefreshingDocs] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);

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

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  const handleSavePath = useCallback(async (initialize: boolean) => {
    if (!pathInput.trim()) return;
    if (initialize) setInitializing(true);
    try {
      const res = await fetch("/api/settings/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathInput.trim(), initialize }),
      });
      if (res.ok) {
        await fetchWorkspace();
      }
    } catch (e) {
      console.error("Failed to save workspace path:", e);
    } finally {
      setInitializing(false);
    }
  }, [pathInput, fetchWorkspace]);

  const handleSelectFolder = useCallback(async () => {
    try {
      const w = window as unknown as { electronAPI?: { selectFolder?: () => Promise<string | null> } };
      if (w.electronAPI?.selectFolder) {
        const selected = await w.electronAPI.selectFolder();
        if (selected) {
          setPathInput(selected);
        }
      } else {
        const input = prompt("Enter workspace directory path:");
        if (input) setPathInput(input);
      }
    } catch (e) {
      console.error("Failed to select folder:", e);
    }
  }, []);

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

  /** Create a new onboarding session in the assistant project folder and navigate to it */
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

  /** Create or reuse a check-in session in the assistant project folder and navigate to it */
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const checkInDoneToday = workspace?.state?.lastCheckInDate === today;

  return (
    <div className="space-y-4">
      {/* Workspace Path Card */}
      <div className="rounded-lg border border-border/50 p-4">
        <h2 className="text-sm font-medium">{t('assistant.workspacePath')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('assistant.workspacePathHint')}</p>
        <div className="flex items-center gap-2 mt-3">
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="/path/to/workspace"
            className="flex-1 rounded-md border border-border/50 bg-background px-3 py-1.5 text-sm"
          />
          <Button variant="outline" size="sm" onClick={handleSelectFolder}>
            {t('assistant.selectFolder')}
          </Button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Button size="sm" onClick={() => handleSavePath(false)} disabled={!pathInput.trim()}>
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSavePath(true)}
            disabled={!pathInput.trim() || initializing}
          >
            {initializing ? (
              <>
                <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin mr-1" />
                {t('assistant.initializing')}
              </>
            ) : (
              t('assistant.initialize')
            )}
          </Button>
        </div>
      </div>

      {/* File Status Card */}
      {workspace?.path && (
        <div className="rounded-lg border border-border/50 p-4">
          <h2 className="text-sm font-medium">{t('assistant.fileStatus')}</h2>
          <div className="mt-3 space-y-2">
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
          </div>
        </div>
      )}

      {/* Onboarding Status Card */}
      {workspace?.path && (
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
                <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />
              ) : workspace.state?.onboardingComplete
                ? t('assistant.redoOnboarding')
                : t('assistant.startOnboarding')
              }
            </Button>
          </div>
        </div>
      )}

      {/* Daily Check-in Card */}
      {workspace?.path && (
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
                <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t('assistant.startCheckIn')
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Directory Docs Card */}
      {workspace?.path && (
        <div className="rounded-lg border border-border/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">{t('assistant.refreshDocs')}</h2>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshDocs}
              disabled={refreshingDocs}
            >
              {refreshingDocs ? (
                <>
                  <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin mr-1" />
                  {t('assistant.refreshingDocs')}
                </>
              ) : (
                t('assistant.refreshDocs')
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
