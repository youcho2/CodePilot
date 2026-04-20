"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { X, Plus } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { FileTree } from "@/components/project/FileTree";
import { TaskList } from "@/components/project/TaskList";

const TREE_MIN_WIDTH = 220;
const TREE_MAX_WIDTH = 500;
const TREE_DEFAULT_WIDTH = 280;

export function FileTreePanel() {
  const { workingDirectory, sessionId, previewFile, setPreviewFile, setPreviewOpen, setFileTreeOpen } = usePanel();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const [width, setWidth] = useState(TREE_DEFAULT_WIDTH);
  const [newFileMode, setNewFileMode] = useState(false);
  const [newFileName, setNewFileName] = useState("untitled.md");
  const [newFileError, setNewFileError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [treeReloadKey, setTreeReloadKey] = useState(0);
  const newFileInputRef = useRef<HTMLInputElement | null>(null);

  // When the user opens the new-file input, select just the filename stem
  // (everything before the final dot) so typing immediately replaces
  // "untitled" while keeping the .md extension.
  useEffect(() => {
    if (newFileMode && newFileInputRef.current) {
      const input = newFileInputRef.current;
      input.focus();
      const dot = input.value.lastIndexOf(".");
      input.setSelectionRange(0, dot >= 0 ? dot : input.value.length);
    }
  }, [newFileMode]);

  const highlightPath = searchParams.get('file') || undefined;
  const highlightSeek = searchParams.get('seek') || undefined;

  const handleResize = useCallback((delta: number) => {
    setWidth((w) => Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, w - delta)));
  }, []);

  const handleFileAdd = useCallback((path: string) => {
    window.dispatchEvent(new CustomEvent('attach-file-to-chat', { detail: { path } }));
  }, []);

  /**
   * Create a new Markdown file directly under the current workingDirectory.
   * Calls /api/files/write with createParents=false and overwrite=false —
   * the API will return 409 if the chosen name already exists, which we
   * surface inline instead of silently clobbering. After a successful
   * create we open the new file in PreviewPanel so the user lands on
   * a ready-to-edit state (editing surface comes from SkillEditor-style
   * MarkdownEditor in later Phase 4 work).
   */
  const handleCreateFile = useCallback(async () => {
    setNewFileError(null);
    const trimmed = newFileName.trim();
    if (!trimmed) {
      setNewFileError(t('fileTree.newFileErrorEmpty'));
      return;
    }
    if (!workingDirectory) {
      setNewFileError(t('fileTree.newFileErrorNoWorkspace'));
      return;
    }
    setCreating(true);
    try {
      // Build the target path under the workspace. path.join would be nicer
      // but this component is a Client Component — just use string concat
      // and normalize separator for the current platform via the API's
      // path.resolve on the server side.
      const separator = workingDirectory.includes("\\") ? "\\" : "/";
      const targetPath = `${workingDirectory}${separator}${trimmed}`;
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: targetPath,
          baseDir: workingDirectory,
          content: `# ${trimmed.replace(/\.[^.]+$/, "")}\n\n`,
          overwrite: false,
          createParents: false,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNewFileError(data.error || t('fileTree.newFileErrorGeneric'));
        return;
      }
      const data = await res.json();
      setNewFileMode(false);
      setNewFileName("untitled.md");
      // Reload file tree so the new file appears
      setTreeReloadKey((k) => k + 1);
      // Open the new file in preview
      setPreviewFile(data.path);
      setPreviewOpen(true);
    } catch (err) {
      setNewFileError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }, [newFileName, workingDirectory, t, setPreviewFile, setPreviewOpen]);

  const handleFileSelect = useCallback((path: string) => {
    const ext = path.split(".").pop()?.toLowerCase() || "";

    // Truly non-previewable: archives, binaries, office docs, fonts
    const NON_PREVIEWABLE = new Set([
      "zip", "tar", "gz", "rar", "7z", "bz2",
      "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
      "exe", "dll", "so", "dylib", "bin", "dmg", "iso",
      "woff", "woff2", "ttf", "otf", "eot",
      "flv", "wmv", "wma",
    ]);
    if (NON_PREVIEWABLE.has(ext)) return;

    // Toggle: clicking the same file closes the preview
    if (previewFile === path) {
      setPreviewFile(null);
      setPreviewOpen(false);
    } else {
      setPreviewFile(path);
      setPreviewOpen(true);
    }
  }, [previewFile, setPreviewFile, setPreviewOpen]);

  return (
    <div className="flex h-full shrink-0 overflow-hidden">
      <ResizeHandle side="left" onResize={handleResize} />
      <div className="flex h-full flex-1 flex-col overflow-hidden border-r border-border/40 bg-background" style={{ width }}>
        {/* Header */}
        <div className="flex h-10 shrink-0 items-center justify-between px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('panel.files')}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setNewFileMode((m) => !m)}
              disabled={!workingDirectory}
              title={t('fileTree.newMarkdown')}
            >
              <Plus size={14} />
              <span className="sr-only">{t('fileTree.newMarkdown')}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setFileTreeOpen(false)}
            >
              <X size={14} />
              <span className="sr-only">{t('panel.closePanel')}</span>
            </Button>
          </div>
        </div>

        {/* New file input row (shown when user clicks + in header). Enter
            submits, Esc cancels. Error surfaces below the input. */}
        {newFileMode && (
          <div className="shrink-0 border-b border-border/40 bg-muted/30 px-3 py-2 space-y-1">
            <div className="flex items-center gap-1.5">
              <Input
                ref={newFileInputRef}
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!creating) void handleCreateFile();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setNewFileMode(false);
                    setNewFileError(null);
                  }
                }}
                placeholder="untitled.md"
                className="h-7 text-xs font-mono"
                disabled={creating}
              />
              <Button
                size="xs"
                onClick={() => void handleCreateFile()}
                disabled={creating || !newFileName.trim()}
              >
                {creating ? "…" : t('fileTree.createButton')}
              </Button>
            </div>
            {newFileError && (
              <p className="text-[11px] text-destructive">{newFileError}</p>
            )}
            <p className="text-[10px] text-muted-foreground/60">
              {t('fileTree.newFileHint')}
            </p>
          </div>
        )}

        {/* Body — TaskList + divider + FileTree */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* Tasks */}
          <div className="shrink-0 px-3 pb-3">
            <TaskList sessionId={sessionId} />
          </div>

          {/* Divider */}
          <div className="mx-3 mt-1 mb-2 border-t border-border/40" />

          {/* File tree. Key changes after a successful create so the tree
              reloads its directory scan and the new file appears. */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <FileTree
              key={treeReloadKey}
              workingDirectory={workingDirectory}
              onFileSelect={handleFileSelect}
              onFileAdd={handleFileAdd}
              highlightPath={highlightPath}
              highlightSeek={highlightSeek}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
