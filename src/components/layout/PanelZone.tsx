"use client";

/**
 * PanelZone — light right-rail container.
 *
 * Mounts:
 *   - FileTreePanel — independent topbar entry. The file tree is a
 *     high-frequency deterministic tool, kept out of the Workspace
 *     Sidebar so a quick file lookup doesn't drag the user into the
 *     full Tab shell.
 *   - AssistantPanel — assistant-workspace surface; doesn't fit the
 *     AI-work-surface Tab model, so it lives here as its own concern.
 *
 * The Git / Widget / Markdown / Artifact / file-preview surfaces all
 * live inside `<WorkspaceSidebar>` as fixed or dynamic Tabs and never
 * render here.
 *
 * Mutual exclusion with the Workspace Sidebar is enforced at the
 * topbar onClick handlers (UnifiedTopBar): opening one closes the
 * other so two right rails never squeeze the chat at once.
 */

import dynamic from "next/dynamic";
import { usePanel } from "@/hooks/usePanel";

const FileTreePanel = dynamic(() => import("./panels/FileTreePanel").then(m => ({ default: m.FileTreePanel })), { ssr: false });
const AssistantPanel = dynamic(() => import("./panels/AssistantPanel").then(m => ({ default: m.AssistantPanel })), { ssr: false });

export function PanelZone() {
  const { fileTreeOpen, assistantPanelOpen } = usePanel();

  const anyOpen = fileTreeOpen || assistantPanelOpen;

  if (!anyOpen) return null;

  return (
    <div className="flex h-full shrink-0 border-l border-border/40 overflow-hidden">
      {assistantPanelOpen && <AssistantPanel />}
      {fileTreeOpen && <FileTreePanel />}
    </div>
  );
}
