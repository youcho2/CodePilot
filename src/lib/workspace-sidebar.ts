/**
 * Workspace Sidebar — pure state model.
 *
 * The sidebar always carries two fixed Tabs (`git`, `widget`) plus zero
 * or more dynamic Tabs (markdown/artifact/file/files-pinned). Dynamic
 * Tabs are deduped by a `key` so the same `.md` file opened twice
 * surfaces the existing Tab instead of creating a second.
 *
 * No React here — every helper is referentially transparent so the
 * tests in `unit/workspace-sidebar.test.ts` can drive them directly.
 *
 * See `docs/exec-plans/active/workspace-sidebar-tabs.md` for product
 * intent + the full Track-by-Track plan.
 */

import type { PreviewSource } from '@/hooks/usePanel';

export type FixedTabId = 'git' | 'widget';

export type DynamicTabKind = 'markdown' | 'artifact' | 'file' | 'files-pinned';

export interface FixedTab {
  id: FixedTabId;
  kind: 'fixed';
}

export interface MarkdownTab {
  id: string;        // stable id derived from kind + key
  kind: 'markdown';
  key: string;       // = filePath
  title: string;
  filePath: string;
}

export interface ArtifactTab {
  id: string;
  kind: 'artifact';
  key: string;       // = artifactId or `artifact:${filePath}`
  title: string;
  source: PreviewSource;
}

export interface FilePreviewTab {
  id: string;
  kind: 'file';
  key: string;       // = filePath
  title: string;
  filePath: string;
}

export interface FilesPinnedTab {
  id: 'files-pinned';
  kind: 'files-pinned';
  key: 'files';
  title: string;
}

export type DynamicTab = MarkdownTab | ArtifactTab | FilePreviewTab | FilesPinnedTab;
export type Tab = FixedTab | DynamicTab;

export interface WorkspaceSidebarState {
  /** Whether the shell is rendered. False = collapsed; user must click
   *  the topbar reopen button to surface it. */
  open: boolean;
  /** Pixel width of the shell when open. Persisted across sessions
   *  within the same workspace. */
  width: number;
  /** Currently active Tab `id`. Always points at a Tab in `tabs`. */
  activeTabId: string;
  /** Fixed first, then dynamic in insertion order. */
  tabs: Tab[];
}

// ─── Constants ──────────────────────────────────────────────────────

export const SIDEBAR_MIN_WIDTH = 320;
export const SIDEBAR_MAX_WIDTH = 800;
export const SIDEBAR_DEFAULT_WIDTH = 480;

const FIXED_TABS: ReadonlyArray<FixedTab> = [
  { id: 'git', kind: 'fixed' },
  { id: 'widget', kind: 'fixed' },
];

export function isFixedTab(tab: Tab): tab is FixedTab {
  return tab.kind === 'fixed';
}

export function isDynamicTab(tab: Tab): tab is DynamicTab {
  return tab.kind !== 'fixed';
}

// ─── Initial state ─────────────────────────────────────────────────

export function initialState(opts?: { open?: boolean; width?: number }): WorkspaceSidebarState {
  return {
    open: opts?.open ?? false,
    width: opts?.width ?? SIDEBAR_DEFAULT_WIDTH,
    activeTabId: 'git',
    tabs: [...FIXED_TABS],
  };
}

// ─── Tab id derivation ─────────────────────────────────────────────

/**
 * Stable id for a dynamic Tab. Same kind + key always returns the
 * same id, so subsequent `addTab` calls can detect & reuse.
 */
export function dynamicTabId(kind: DynamicTabKind, key: string): string {
  return `${kind}:${key}`;
}

// ─── Mutations (returns new state) ─────────────────────────────────

/**
 * Open or focus a dynamic Tab.
 * - If a Tab with the same id already exists → just activate it.
 * - Otherwise → append at the end of the dynamic list and activate it.
 *
 * Always sets `open: true` (caller wants the sidebar surfaced).
 */
export function openDynamicTab(
  state: WorkspaceSidebarState,
  tab: DynamicTab,
): WorkspaceSidebarState {
  const existing = state.tabs.find((t) => t.id === tab.id);
  if (existing) {
    return { ...state, open: true, activeTabId: existing.id };
  }
  return {
    ...state,
    open: true,
    activeTabId: tab.id,
    tabs: [...state.tabs, tab],
  };
}

/**
 * Close a Tab by id. Fixed Tabs are never closable, so this is a no-op
 * for them. After closing, activate the previous Tab in the list (or
 * fall back to the first fixed Tab).
 */
export function closeTab(
  state: WorkspaceSidebarState,
  id: string,
): WorkspaceSidebarState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return state;
  const target = state.tabs[idx];
  if (isFixedTab(target)) return state;
  const nextTabs = state.tabs.filter((t) => t.id !== id);
  let nextActive = state.activeTabId;
  if (state.activeTabId === id) {
    // Prefer the Tab that was sitting to the left, else the first one.
    nextActive = nextTabs[Math.max(0, idx - 1)]?.id ?? nextTabs[0]?.id ?? 'git';
  }
  return { ...state, tabs: nextTabs, activeTabId: nextActive };
}

export function setActiveTab(state: WorkspaceSidebarState, id: string): WorkspaceSidebarState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { ...state, activeTabId: id, open: true };
}

export function setOpen(state: WorkspaceSidebarState, open: boolean): WorkspaceSidebarState {
  if (state.open === open) return state;
  return { ...state, open };
}

export function setWidth(state: WorkspaceSidebarState, width: number): WorkspaceSidebarState {
  const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
  if (state.width === clamped) return state;
  return { ...state, width: clamped };
}

// ─── Persistence ───────────────────────────────────────────────────

/**
 * localStorage key. Scoped by workspace + session so two projects
 * (or two sessions in the same workspace) don't share Tab lists.
 *
 * `null` workingDirectory or sessionId → 'global' bucket so the user
 * gets a sensible default before a chat is selected.
 */
export function storageKey(workingDirectory: string | null | undefined, sessionId: string | null | undefined): string {
  const wd = workingDirectory && workingDirectory.length > 0 ? workingDirectory : 'global';
  const sid = sessionId && sessionId.length > 0 ? sessionId : 'global';
  return `codepilot:workspace-sidebar::${wd}::${sid}`;
}

/**
 * Subset of state we persist. Dynamic Tabs ARE persisted so reloading
 * the page doesn't lose the user's open previews; fixed Tabs are
 * always materialised from FIXED_TABS at load so we don't drift if
 * the fixed-tab list grows.
 */
interface SerializedState {
  open: boolean;
  width: number;
  activeTabId: string;
  dynamicTabs: DynamicTab[];
}

export function serialize(state: WorkspaceSidebarState): SerializedState {
  return {
    open: state.open,
    width: state.width,
    activeTabId: state.activeTabId,
    dynamicTabs: state.tabs.filter(isDynamicTab),
  };
}

/**
 * Inverse of `serialize`. Defensive against malformed stored values:
 * any failure returns a fresh `initialState()` rather than throwing.
 */
export function parse(raw: string | null | undefined): WorkspaceSidebarState {
  if (!raw) return initialState();
  try {
    const data = JSON.parse(raw) as Partial<SerializedState>;
    const dynamicTabs = Array.isArray(data.dynamicTabs)
      ? data.dynamicTabs.filter(isParsableDynamicTab)
      : [];
    const tabs: Tab[] = [...FIXED_TABS, ...dynamicTabs];
    const fallbackActive = 'git';
    const desired = typeof data.activeTabId === 'string' ? data.activeTabId : fallbackActive;
    const activeTabId = tabs.some((t) => t.id === desired) ? desired : fallbackActive;
    return {
      open: typeof data.open === 'boolean' ? data.open : false,
      width: typeof data.width === 'number'
        ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, data.width))
        : SIDEBAR_DEFAULT_WIDTH,
      activeTabId,
      tabs,
    };
  } catch {
    return initialState();
  }
}

function isParsableDynamicTab(value: unknown): value is DynamicTab {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<DynamicTab> & { kind?: string; id?: string; key?: string };
  if (typeof v.id !== 'string' || typeof v.key !== 'string') return false;
  return v.kind === 'markdown' || v.kind === 'artifact' || v.kind === 'file' || v.kind === 'files-pinned';
}

// =====================================================================
// Tab descriptor derivation from a PreviewSource
// =====================================================================

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx']);

/**
 * Derive a dynamic Tab descriptor from a PreviewSource (the existing
 * AppShell discriminator). Used by the window-event bridge so any
 * call to `setPreviewSource(...)` on a chat-detail route surfaces in
 * the Workspace Sidebar as a Tab.
 *
 * - file kind, .md/.mdx → markdown Tab keyed by filePath
 * - file kind, anything else → file Tab keyed by filePath
 * - inline-* kinds → artifact Tab keyed by virtualName or generated id
 */
export function tabFromPreviewSource(source: PreviewSource): DynamicTab {
  if (source.kind === 'file') {
    const ext = (source.filePath.split('.').pop() || '').toLowerCase();
    const title = source.filePath.split(/[\\/]/).filter(Boolean).pop() || source.filePath;
    if (MARKDOWN_EXTENSIONS.has(ext)) {
      return {
        id: dynamicTabId('markdown', source.filePath),
        kind: 'markdown',
        key: source.filePath,
        title,
        filePath: source.filePath,
      };
    }
    return {
      id: dynamicTabId('file', source.filePath),
      kind: 'file',
      key: source.filePath,
      title,
      filePath: source.filePath,
    };
  }
  // inline-html / inline-jsx / inline-datatable — artifact Tab. The
  // shared `virtualName` field is the only stable identifier across the
  // three inline kinds; fall back to a kind-prefixed string when missing
  // so two unnamed inline payloads of the same kind still dedupe to one
  // Tab (good enough for Phase 1).
  const fingerprint = source.virtualName ?? `inline-${source.kind}`;
  return {
    id: dynamicTabId('artifact', fingerprint),
    kind: 'artifact',
    key: fingerprint,
    title: source.virtualName || fingerprint,
    source,
  };
}

/**
 * Inverse of `tabFromPreviewSource`: given an active dynamic Tab,
 * return the PreviewSource that PreviewPanel should render.
 *
 * Returns `null` for fixed Tabs (`git`, `widget`) and the Files Pinned
 * Tab — those don't render the preview surface, so callers should
 * leave `previewSource` untouched (the previously-shown file stays
 * loaded but invisible until the user re-activates a preview Tab).
 *
 * Used by `TabPanel`'s sync effect so switching dynamic Tabs swaps
 * the content (Codex P1). Without this, all dynamic Tabs would share
 * the single global `previewSource` and clicking back to an earlier
 * Tab would still display the most-recently-opened content.
 */
export function previewSourceFromTab(tab: Tab): PreviewSource | null {
  if (tab.kind === 'markdown' || tab.kind === 'file') {
    return { kind: 'file', filePath: tab.filePath };
  }
  if (tab.kind === 'artifact') {
    return tab.source;
  }
  // 'fixed' / 'files-pinned' — preview surface isn't theirs to drive.
  return null;
}
