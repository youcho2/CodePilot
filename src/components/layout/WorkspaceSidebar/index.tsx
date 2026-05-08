'use client';

/**
 * WorkspaceSidebar — the right-side shell.
 *
 * Renders nothing when the user has collapsed it (open === false);
 * the topbar reopen button is responsible for surfacing it again.
 *
 * Always-rendered structure when open:
 *   [ResizeHandle] [TabBar] [TabPanel]
 *
 * Width state lives in WorkspaceSidebarContext (persisted via
 * localStorage). ResizeHandle delivers pixel deltas; we clamp inside
 * the pure model.
 */

import { useCallback } from 'react';
import { ResizeHandle } from '@/components/layout/ResizeHandle';
import { useWorkspaceSidebar } from '@/hooks/useWorkspaceSidebar';
import { TabBar } from './TabBar';
import { TabPanel } from './TabPanel';

export function WorkspaceSidebar() {
  const { state, setWidth } = useWorkspaceSidebar();

  // ResizeHandle on a right-side panel: dragging left → wider, so we
  // subtract the delta. Same convention as the existing PreviewPanel /
  // GitPanel resize. Clamp happens inside the pure model.
  const handleResize = useCallback(
    (delta: number) => {
      setWidth(state.width - delta);
    },
    [state.width, setWidth],
  );

  if (!state.open) return null;

  return (
    <div className="flex h-full shrink-0 overflow-hidden" data-workspace-sidebar>
      <ResizeHandle side="left" onResize={handleResize} />
      <div
        className="flex h-full flex-col overflow-hidden border-l border-border/40 bg-background"
        style={{ width: state.width }}
      >
        <TabBar />
        <TabPanel />
      </div>
    </div>
  );
}
