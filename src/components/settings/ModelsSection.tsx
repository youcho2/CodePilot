"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Plus,
  Trash,
  PencilSimple,
  CaretUp,
  CaretDown,
  MagnifyingGlass,
  SpinnerGap,
  Check,
  X,
} from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { getProviderIcon } from "./provider-presets";
import { getProviderCompat, getModelCompat, compatLabel, compatTone, compatTooltip } from "@/lib/runtime-compat";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ApiProvider, ProviderModel, ProviderModelSource } from "@/types";

/**
 * Settings > Models
 *
 * Single source of truth for what shows up in chat-side model pickers.
 * Grouped by provider. V1 surface (per spec):
 *   - enable / hide toggle
 *   - search across model_id + display_name (all providers)
 *   - reorder via up/down (no drag-drop)
 *   - rename display_name
 *   - manually add a model
 *   - delete a manual model
 *
 * Out of scope (V1): capability auto-detection, drag-drop sort, capability
 * editing UI. Those land in a follow-up.
 *
 * Refresh / discovery happens elsewhere (Provider card kebab → "刷新模型")
 * and goes through the diff-preview flow; this page surfaces the resulting
 * `provider_models` rows but doesn't probe upstream itself.
 */

interface ProviderModelsBundle {
  provider: ApiProvider;
  models: ProviderModel[];
}

const SOURCE_LABEL_ZH: Record<ProviderModelSource, string> = {
  api: 'API 同步',
  catalog: '内置目录',
  manual: '手动添加',
  role_mapping: '角色映射',
  sdk_default: 'SDK 默认',
};
const SOURCE_LABEL_EN: Record<ProviderModelSource, string> = {
  api: 'From API',
  catalog: 'Catalog',
  manual: 'Manual',
  role_mapping: 'Role mapping',
  sdk_default: 'SDK default',
};
const SOURCE_TONE: Record<ProviderModelSource, string> = {
  api: 'bg-status-success-muted text-status-success-foreground',
  catalog: 'bg-muted text-muted-foreground',
  manual: 'bg-primary/10 text-primary',
  role_mapping: 'bg-status-warning-muted text-status-warning-foreground',
  sdk_default: 'bg-muted text-muted-foreground',
};

function formatRefreshedAt(iso: string | null, isZh: boolean): string {
  if (!iso) return isZh ? '从未同步' : 'Never refreshed';
  // The DB stores "YYYY-MM-DD HH:MM:SS" UTC-ish. Render relative-ish form.
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return isZh ? '刚刚' : 'just now';
  if (diffMin < 60) return isZh ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return isZh ? `${diffH} 小时前` : `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return isZh ? `${diffD} 天前` : `${diffD}d ago`;
}

export function ModelsSection() {
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [bundles, setBundles] = useState<Record<string, ProviderModel[]>>({});
  const [loading, setLoading] = useState(true);
  type ViewFilter = 'enabled' | 'hidden' | 'all';
  const [viewFilter, setViewFilter] = useState<ViewFilter>('enabled');
  type RuntimeFilter = 'all' | 'claude_code_ready' | 'claude_code_verified' | 'claude_code_experimental' | 'codepilot_only' | 'unknown';
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>('all');
  const [search, setSearch] = useState('');

  // Add-model dialog state
  const [addDialog, setAddDialog] = useState<{ providerId: string; providerName: string } | null>(null);
  const [newModelId, setNewModelId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ providerId: string; modelId: string; name: string } | null>(null);

  // Bulk toggle confirmation. "全部启用 / 全部关闭" can flip 100+ models
  // in one click on big providers; without confirm the action looks too
  // light for what it does. Show an AlertDialog summarising affected
  // count before executing.
  const [bulkConfirm, setBulkConfirm] = useState<{ providerId: string; providerName: string; target: 0 | 1; affected: number } | null>(null);

  // Inline rename state — keyed by `${providerId}::${modelId}`
  const [editingDisplay, setEditingDisplay] = useState<string | null>(null);
  const [draftDisplay, setDraftDisplay] = useState('');

  // Role-mapping dialog state. role_models_json is parsed lazily per
  // provider; persistance goes through PUT /api/providers/[id].
  type RoleKey = 'default' | 'reasoning' | 'small' | 'sonnet' | 'opus' | 'haiku';
  const ROLE_KEYS: RoleKey[] = ['default', 'sonnet', 'opus', 'haiku', 'reasoning', 'small'];
  const ROLE_LABEL_ZH: Record<RoleKey, string> = {
    default: '默认（兜底）',
    sonnet: 'Sonnet 角色',
    opus: 'Opus 角色',
    haiku: 'Haiku 角色',
    reasoning: '推理（reasoning）',
    small: '小模型（small）',
  };
  const ROLE_LABEL_EN: Record<RoleKey, string> = {
    default: 'Default (fallback)',
    sonnet: 'Sonnet role',
    opus: 'Opus role',
    haiku: 'Haiku role',
    reasoning: 'Reasoning',
    small: 'Small',
  };
  const ROLE_HINT_ZH: Record<RoleKey, string> = {
    default: '没有指定模型时用这个；也是 ANTHROPIC_MODEL 的来源',
    sonnet: 'Claude Code 选 Sonnet 时实际跑的模型',
    opus: 'Claude Code 选 Opus 时实际跑的模型',
    haiku: 'Claude Code 选 Haiku 时实际跑的模型',
    reasoning: '复杂推理任务（聊天里专门挑 reasoning 时使用）',
    small: '子代理 / 便宜操作（子任务 / 简单总结时使用）',
  };
  const ROLE_HINT_EN: Record<RoleKey, string> = {
    default: 'Used when no specific model is requested; also feeds ANTHROPIC_MODEL',
    sonnet: 'What Claude Code actually runs when you pick Sonnet',
    opus: 'What Claude Code actually runs when you pick Opus',
    haiku: 'What Claude Code actually runs when you pick Haiku',
    reasoning: 'Complex reasoning tasks (when chat asks for reasoning role)',
    small: 'Sub-agents / cheap ops (sub-tasks / simple summaries)',
  };

  const [roleDialog, setRoleDialog] = useState<{ providerId: string; providerName: string } | null>(null);
  const [roleDraft, setRoleDraft] = useState<Record<RoleKey, string>>({ default: '', sonnet: '', opus: '', haiku: '', reasoning: '', small: '' });
  const [roleSaving, setRoleSaving] = useState(false);

  const parseRoleModels = (provider: ApiProvider): Record<RoleKey, string> => {
    try {
      const parsed = JSON.parse(provider.role_models_json || '{}');
      return {
        default: parsed.default || '',
        sonnet: parsed.sonnet || '',
        opus: parsed.opus || '',
        haiku: parsed.haiku || '',
        reasoning: parsed.reasoning || '',
        small: parsed.small || '',
      };
    } catch {
      return { default: '', sonnet: '', opus: '', haiku: '', reasoning: '', small: '' };
    }
  };

  const openRoleDialog = useCallback((provider: ApiProvider) => {
    setRoleDialog({ providerId: provider.id, providerName: provider.name });
    setRoleDraft(parseRoleModels(provider));
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const provRes = await fetch('/api/providers');
      if (!provRes.ok) throw new Error('Failed to load providers');
      const provData = await provRes.json();
      // Image providers are managed inline on their Provider card (model
      // chips in the children slot, picked from a hardcoded image-only
      // list). Don't surface them here — the picker would be confusing
      // since they don't share the same model_id semantics as chat models.
      const provList: ApiProvider[] = (provData.providers || []).filter(
        (p: ApiProvider) => p.provider_type !== 'gemini-image' && p.provider_type !== 'openai-image',
      );
      setProviders(provList);

      const next: Record<string, ProviderModel[]> = {};
      await Promise.all(provList.map(async (p) => {
        try {
          const r = await fetch(`/api/providers/${p.id}/models?all=1`);
          if (r.ok) {
            const d = await r.json();
            next[p.id] = d.models || [];
          } else {
            next[p.id] = [];
          }
        } catch {
          next[p.id] = [];
        }
      }));
      setBundles(next);
    } finally {
      setLoading(false);
    }
  }, []);

  // Persist edited role mappings via PUT /api/providers/[id] (the existing
  // provider PUT route already handles role_models_json). Defined here
  // because it depends on `fetchAll`, which is declared above.
  const handleSaveRoles = useCallback(async () => {
    if (!roleDialog) return;
    const provider = providers.find(p => p.id === roleDialog.providerId);
    if (!provider) return;
    setRoleSaving(true);
    try {
      const next: Record<string, string> = {};
      for (const k of ROLE_KEYS) {
        const v = roleDraft[k]?.trim();
        if (v) next[k] = v;
      }
      const res = await fetch(`/api/providers/${provider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: provider.name,
          provider_type: provider.provider_type,
          base_url: provider.base_url,
          api_key: provider.api_key,
          extra_env: provider.extra_env,
          role_models_json: JSON.stringify(next),
        }),
      });
      if (res.ok) {
        await fetchAll();
        window.dispatchEvent(new Event('provider-changed'));
      }
    } finally {
      setRoleSaving(false);
      setRoleDialog(null);
    }
  }, [roleDialog, providers, roleDraft, fetchAll, ROLE_KEYS]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  // Don't listen to `provider-changed` — local edits already update bundles
  // from the PATCH response, and a full refetch flips the `loading` flag,
  // unmounts the list, and loses the user's scroll position. The chat-side
  // listeners still pick up the event so the global default-model selector
  // refreshes; this page just stays put.

  // Focus signal from ProviderCard's "管理模型" jump. ModelsSection scrolls
  // the matching section into view once data has loaded, then clears the
  // sessionStorage signal so re-opening the page later doesn't re-trigger.
  useEffect(() => {
    if (loading) return;
    if (typeof window === 'undefined') return;
    const focusId = sessionStorage.getItem('codepilot:models-focus-provider');
    if (!focusId) return;
    sessionStorage.removeItem('codepilot:models-focus-provider');
    // Defer to next paint so DOM is in place after data loaded.
    requestAnimationFrame(() => {
      const el = document.getElementById(`provider-section-${focusId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [loading, providers]);

  const visibleBundles: ProviderModelsBundle[] = useMemo(() => {
    const sorted = [...providers].sort((a, b) => a.sort_order - b.sort_order);
    let bundlesOut = sorted.map((provider) => {
      let models = bundles[provider.id] || [];
      if (viewFilter === 'enabled') models = models.filter(m => m.enabled === 1);
      else if (viewFilter === 'hidden') models = models.filter(m => m.enabled === 0);
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        models = models.filter(m =>
          m.model_id.toLowerCase().includes(q) ||
          m.display_name.toLowerCase().includes(q),
        );
      }
      return { provider, models };
    });
    // Runtime filter — applied per row via getModelCompat. Provider compat
    // and model compat are not the same thing: a `codepilot_only` provider
    // could in principle hold a row whose catalog capability flags shift
    // its model-layer compat (most don't today, but the data model allows
    // it), and per-row evaluation keeps the filter honest as catalog
    // capabilities get filled in. Empty bundles are dropped from the
    // result so the page doesn't render a section header for a provider
    // with zero matching rows.
    if (runtimeFilter !== 'all') {
      bundlesOut = bundlesOut
        .map(b => {
          const providerCompat = getProviderCompat({
            provider_type: b.provider.provider_type,
            base_url: b.provider.base_url,
          });
          // Filter rows by checking each model's compat against the
          // selected provider tier. The `runtimeFilter` value is a
          // provider-tier label (e.g. `claude_code_verified`); a row
          // belongs to the visible set when its provider lives in that
          // tier AND `getModelCompat` doesn't strip it for being media.
          const filteredModels = b.models.filter(m => {
            if (providerCompat !== runtimeFilter) return false;
            const cap = getModelCompat({
              modelId: m.model_id,
              upstreamModelId: m.upstream_model_id || undefined,
              providerCompat,
            });
            // Drop media-only rows and rows that have no chat-side flag
            // (a defensive zero-flag check; today this matches if a
            // future capability ever marks a row entirely non-chat).
            if (cap.media) return false;
            return !!cap.claude_code_compatible || !!cap.codepilot_runtime_compatible;
          });
          return { provider: b.provider, models: filteredModels };
        })
        .filter(b => b.models.length > 0);
    }
    return bundlesOut;
  }, [providers, bundles, search, viewFilter, runtimeFilter]);

  // Aggregate counts for the filter tabs.
  const filterCounts = useMemo(() => {
    let enabled = 0, hidden = 0;
    for (const provider of providers) {
      const list = bundles[provider.id] || [];
      for (const m of list) {
        if (m.enabled === 1) enabled++; else hidden++;
      }
    }
    return { enabled, hidden, all: enabled + hidden };
  }, [providers, bundles]);

  const updateModel = useCallback(async (
    providerId: string,
    modelId: string,
    fields: { display_name?: string; enabled?: number; sort_order?: number },
  ) => {
    const res = await fetch(`/api/providers/${providerId}/models`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, ...fields }),
    });
    if (res.ok) {
      const d = await res.json();
      setBundles((prev) => ({ ...prev, [providerId]: d.models || [] }));
      window.dispatchEvent(new Event('provider-changed'));
    }
  }, []);

  const handleToggleEnabled = useCallback((providerId: string, model: ProviderModel) => {
    updateModel(providerId, model.model_id, { enabled: model.enabled === 1 ? 0 : 1 });
  }, [updateModel]);

  // Global align dialog state — fetches a dry-run preview first, lets the
  // user see the per-provider impact (insert/enable/hide/prune counts), and
  // only writes when they confirm.
  type AlignPreviewRow = {
    providerId: string;
    providerName: string;
    catalogSize: number;
    enabled: number;
    disabled: number;
    unchanged: number;
    inserted: number;
    pruned: number;
    skipped?: boolean;
  };
  const [alignAllOpen, setAlignAllOpen] = useState(false);
  const [alignAllPhase, setAlignAllPhase] = useState<'idle' | 'previewing' | 'preview-ready' | 'applying'>('idle');
  const [alignPreview, setAlignPreview] = useState<AlignPreviewRow[]>([]);

  const openAlignDialog = useCallback(async () => {
    setAlignAllOpen(true);
    setAlignAllPhase('previewing');
    setAlignPreview([]);
    try {
      const res = await fetch('/api/models/align-all-with-catalog?dryRun=1', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setAlignPreview(data.results || []);
      }
    } finally {
      setAlignAllPhase('preview-ready');
    }
  }, []);

  const handleAlignAll = useCallback(async () => {
    setAlignAllPhase('applying');
    try {
      const res = await fetch('/api/models/align-all-with-catalog', { method: 'POST' });
      if (res.ok) {
        await fetchAll();
        window.dispatchEvent(new Event('provider-changed'));
      }
    } finally {
      setAlignAllOpen(false);
      setAlignAllPhase('idle');
      setAlignPreview([]);
    }
  }, [fetchAll]);

  /** Bulk toggle all models for one provider — used by the "全部关闭/启用"
   *  header button. Skips rows that already have the target state to avoid
   *  needless PATCHes (and unnecessary user_edited flips). */
  const handleBulkToggle = useCallback(async (providerId: string, target: 0 | 1) => {
    const list = bundles[providerId] || [];
    const todo = list.filter(m => m.enabled !== target);
    if (todo.length === 0) return;
    await Promise.all(todo.map(m =>
      fetch(`/api/providers/${providerId}/models`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: m.model_id, enabled: target }),
      }).catch(() => {}),
    ));
    // Single refetch after the batch to avoid N renders.
    try {
      const r = await fetch(`/api/providers/${providerId}/models?all=1`);
      if (r.ok) {
        const d = await r.json();
        setBundles((prev) => ({ ...prev, [providerId]: d.models || [] }));
      }
    } catch { /* ignore */ }
    window.dispatchEvent(new Event('provider-changed'));
  }, [bundles]);

  const handleMove = useCallback((providerId: string, models: ProviderModel[], idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= models.length) return;
    const a = models[idx];
    const b = models[target];
    // Swap sort_order between the pair. Both rows are PATCHed; the optimistic
    // re-sort happens server-side via getAllModelsForProvider.
    Promise.all([
      updateModel(providerId, a.model_id, { sort_order: b.sort_order }),
      updateModel(providerId, b.model_id, { sort_order: a.sort_order }),
    ]);
  }, [updateModel]);

  const beginRename = (providerId: string, model: ProviderModel) => {
    setEditingDisplay(`${providerId}::${model.model_id}`);
    setDraftDisplay(model.display_name || model.model_id);
  };
  const commitRename = async (providerId: string, modelId: string) => {
    if (!editingDisplay) return;
    const trimmed = draftDisplay.trim();
    if (trimmed) {
      await updateModel(providerId, modelId, { display_name: trimmed });
    }
    setEditingDisplay(null);
  };

  const handleAddModel = useCallback(async () => {
    if (!addDialog || !newModelId.trim()) return;
    const res = await fetch(`/api/providers/${addDialog.providerId}/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_id: newModelId.trim(),
        display_name: newDisplayName.trim() || newModelId.trim(),
      }),
    });
    if (res.ok) {
      const d = await res.json();
      setBundles((prev) => ({ ...prev, [addDialog.providerId]: d.models || [] }));
      window.dispatchEvent(new Event('provider-changed'));
      setAddDialog(null);
      setNewModelId('');
      setNewDisplayName('');
    }
  }, [addDialog, newModelId, newDisplayName]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const res = await fetch(`/api/providers/${deleteTarget.providerId}/models`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: deleteTarget.modelId }),
    });
    if (res.ok) {
      const d = await res.json();
      setBundles((prev) => ({ ...prev, [deleteTarget.providerId]: d.models || [] }));
      window.dispatchEvent(new Event('provider-changed'));
    }
    setDeleteTarget(null);
  }, [deleteTarget]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{isZh ? '模型管理' : 'Model management'}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {isZh
              ? '控制每个服务商对外暴露哪些模型、它们的显示名和顺序。模型来源由 Provider 卡片的「刷新模型」获取，这里只决定如何展示。'
              : 'Control which models each provider exposes, plus their display names and order. Sourcing is driven by the Provider cards\' "Refresh models"; this page decides presentation.'}
          </p>
        </div>
        <div className="flex flex-col items-end shrink-0 gap-0.5">
          <Button
            variant="outline"
            size="sm"
            onClick={openAlignDialog}
            title={isZh ? '按内置推荐清单收紧每个服务商：保留推荐模型为启用、其余隐藏，操作前会先显示预览' : 'Tighten each provider to the built-in recommended list — preview shown before write'}
          >
            {isZh ? '按推荐整理' : 'Tidy by recommended'}
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {isZh ? '会先预览再写入' : 'preview before write'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Filter tabs — uses the shared Tabs component so the rounded-full
            pill geometry + h-9 height match the Luma-style Input/SelectTrigger
            sitting next to it. The Tabs Root is just used as a styled
            container; we don't render TabsContent (the page itself is the
            content), so gap-0 collapses the otherwise-empty vertical gap. */}
        <Tabs
          value={viewFilter}
          onValueChange={(v) => setViewFilter(v as ViewFilter)}
          className="shrink-0 gap-0"
        >
          <TabsList>
            {([
              { key: 'enabled' as const, labelZh: '已启用', labelEn: 'Enabled', count: filterCounts.enabled },
              { key: 'hidden' as const, labelZh: '已隐藏', labelEn: 'Hidden', count: filterCounts.hidden },
              { key: 'all' as const, labelZh: '全部', labelEn: 'All', count: filterCounts.all },
            ]).map((opt) => (
              <TabsTrigger key={opt.key} value={opt.key} className="gap-1.5 text-xs">
                {isZh ? opt.labelZh : opt.labelEn}
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {opt.count}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Channel filter — uses the same compat tags as the cards. Wording
            mirrors `compatLabel` / `compatTooltip` to avoid drift. */}
        <Select value={runtimeFilter} onValueChange={(v) => setRuntimeFilter(v as RuntimeFilter)}>
          <SelectTrigger
            className="w-[180px] shrink-0"
            title={isZh ? '按接入渠道筛选服务商' : 'Filter providers by access channel'}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isZh ? '全部渠道' : 'All channels'}</SelectItem>
            <SelectItem value="claude_code_ready">{compatLabel('claude_code_ready', isZh)}</SelectItem>
            <SelectItem value="claude_code_verified">{compatLabel('claude_code_verified', isZh)}</SelectItem>
            <SelectItem value="claude_code_experimental">{compatLabel('claude_code_experimental', isZh)}</SelectItem>
            <SelectItem value="codepilot_only">{compatLabel('codepilot_only', isZh)}</SelectItem>
            <SelectItem value="unknown">{compatLabel('unknown', isZh)}</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isZh ? '搜索模型 id 或显示名…' : 'Search model id or display name…'}
            className="pl-9"
          />
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          <p className="text-sm">{t('common.loading')}</p>
        </div>
      )}

      {!loading && visibleBundles.length === 0 && (
        <div className="rounded-lg border border-border/50 bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {isZh ? '尚未配置任何服务商。先到「服务商」页连接服务。' : 'No providers configured yet — connect one from the Providers page first.'}
          </p>
        </div>
      )}

      {!loading && visibleBundles.map(({ provider, models }) => {
        // Counts/availability are computed on the FULL provider model list,
        // not the search-filtered slice. Bulk-toggle and reorder operate on
        // the full list too — see the disabled flag tied to `isSearching`
        // below, which prevents accidental mass actions on filtered views.
        const fullModels = bundles[provider.id] || [];
        const enabledCount = fullModels.filter(m => m.enabled === 1).length;
        const allEnabled = fullModels.length > 0 && enabledCount === fullModels.length;
        const allDisabled = fullModels.length > 0 && enabledCount === 0;
        const isSearching = search.trim().length > 0;
        const providerRoles = parseRoleModels(provider);
        const defaultRoleId = providerRoles.default;
        const defaultRoleHidden = !!defaultRoleId
          && fullModels.some(m => m.model_id === defaultRoleId && m.enabled === 0);
        const defaultRoleModel = defaultRoleId
          ? fullModels.find(m => m.model_id === defaultRoleId)
          : undefined;
        const providerCompat = getProviderCompat({
          provider_type: provider.provider_type,
          base_url: provider.base_url,
        });
        // Aggregate latest sync time across this provider's models so the
        // section header shows "上次同步" without users having to scan
        // every row. Excludes nulls (manual / never-synced rows).
        const lastSyncedTimes = fullModels
          .map(m => m.last_refreshed_at)
          .filter((t): t is string => !!t)
          .sort();
        const lastSyncAggregate = lastSyncedTimes.length > 0 ? lastSyncedTimes[lastSyncedTimes.length - 1] : null;
        return (
        <section
          key={provider.id}
          id={`provider-section-${provider.id}`}
          className="space-y-3 scroll-mt-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <div className="shrink-0 size-7 rounded-md bg-muted/60 flex items-center justify-center">
                {getProviderIcon(provider.name, provider.base_url)}
              </div>
              <h3 className="text-sm font-medium truncate">{provider.name}</h3>
              {/* Compat pill — channel-level; one per provider section, not
                  per-row. Same vocabulary as Provider Card so users get a
                  consistent mental model across pages. */}
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium cursor-help whitespace-nowrap',
                  compatTone(providerCompat),
                )}
                title={compatTooltip(providerCompat, isZh)}
              >
                {compatLabel(providerCompat, isZh)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {isSearching
                  ? (isZh
                      ? `${models.length} / ${fullModels.length} 匹配`
                      : `${models.length} / ${fullModels.length} match`)
                  : (isZh
                      ? `${enabledCount} / ${fullModels.length} 启用`
                      : `${enabledCount} / ${fullModels.length} enabled`)}
              </span>
              {/* Inline default-model chip — answers "运行时默认模型是谁"
                  at a glance, with a hidden-warning tone when the default
                  has been disabled in this same page. */}
              {defaultRoleId && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium cursor-help",
                    defaultRoleHidden ? "bg-status-warning-muted text-status-warning-foreground" : "bg-muted text-muted-foreground",
                  )}
                  title={defaultRoleHidden
                    ? (isZh
                        ? `默认模型「${defaultRoleId}」已隐藏，运行时会回退到第一个启用的模型`
                        : `Default "${defaultRoleId}" is hidden — runtime falls back to the first enabled model`)
                    : (isZh
                        ? `没有指定模型时使用：${defaultRoleModel?.display_name || defaultRoleId}`
                        : `Used when no model is specified: ${defaultRoleModel?.display_name || defaultRoleId}`)}
                >
                  {isZh ? '默认' : 'Default'}: {defaultRoleModel?.display_name || defaultRoleId}
                  {defaultRoleHidden && ' ⚠'}
                </span>
              )}
              {/* Section-level "上次同步" — aggregate of the latest
                  last_refreshed_at across this provider's models. Saves
                  users from scanning every row. Hidden if no row has
                  ever synced (manual-only providers). */}
              {lastSyncAggregate && (
                <span
                  className="text-[11px] text-muted-foreground"
                  title={isZh
                    ? `这个服务商最近一次成功刷新模型的时间。点右边「去刷新」回到服务商页执行刷新。`
                    : `This provider's most recent successful model refresh. Use "Refresh" to go to the Providers page and run it.`}
                >
                  {isZh ? '上次同步: ' : 'Last sync: '}
                  {formatRefreshedAt(lastSyncAggregate, isZh)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Cross-link to ProviderManager: model refresh lives there
                  because the diff dialog is owned by ProviderManager; we
                  hand the user back so they're not stranded mid-task. */}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                title={isZh ? '回到服务商页刷新模型 / 编辑凭据' : 'Open Providers page to refresh models / edit credentials'}
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    sessionStorage.setItem('codepilot:providers-focus-provider', provider.id);
                    window.location.hash = '#providers';
                  }
                }}
              >
                {isZh ? '去刷新' : 'Open Providers'}
              </Button>
              {fullModels.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  disabled={allDisabled || isSearching}
                  onClick={() => {
                    const affected = fullModels.filter(m => m.enabled !== 0).length;
                    setBulkConfirm({ providerId: provider.id, providerName: provider.name, target: 0, affected });
                  }}
                  title={isSearching ? (isZh ? '搜索中暂不可用' : 'Disabled while searching') : undefined}
                >
                  {isZh ? '全部关闭' : 'Disable all'}
                </Button>
              )}
              {fullModels.length > 0 && !allEnabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  disabled={isSearching}
                  onClick={() => {
                    const affected = fullModels.filter(m => m.enabled !== 1).length;
                    setBulkConfirm({ providerId: provider.id, providerName: provider.name, target: 1, affected });
                  }}
                  title={isSearching ? (isZh ? '搜索中暂不可用' : 'Disabled while searching') : undefined}
                >
                  {isZh ? '全部启用' : 'Enable all'}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => openRoleDialog(provider)}
                title={isZh ? '设置每个角色（默认 / Sonnet / Opus / Haiku / 推理 / 小模型）实际跑哪个模型' : 'Set which model fills each role (default / sonnet / opus / haiku / reasoning / small)'}
              >
                {isZh ? '角色映射' : 'Roles'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => { setAddDialog({ providerId: provider.id, providerName: provider.name }); setNewModelId(''); setNewDisplayName(''); }}
              >
                <Plus size={12} weight="bold" />
                {isZh ? '添加模型' : 'Add model'}
              </Button>
            </div>
          </div>

          {models.length === 0 ? (
            <div className="rounded-lg border border-border/50 bg-card px-4 py-6 text-center">
              <p className="text-xs text-muted-foreground">
                {search.trim()
                  ? (isZh ? '无匹配结果' : 'No matches')
                  : (isZh ? '该服务商暂无模型 — 刷新或手动添加' : 'No models yet — refresh from Provider card or add manually')}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border/50 bg-card divide-y divide-border/50">
              {models.map((model, idx) => {
                const editing = editingDisplay === `${provider.id}::${model.model_id}`;
                const sourceTone = SOURCE_TONE[model.source as ProviderModelSource] || SOURCE_TONE.manual;
                const sourceLabel = (isZh ? SOURCE_LABEL_ZH : SOURCE_LABEL_EN)[model.source as ProviderModelSource] || model.source;
                return (
                  <div key={model.id} className="px-4 py-3 flex items-center gap-3">
                    {/* Sort buttons — disabled while searching, since the
                        visible `models` is a filtered slice and swapping
                        sort_order between filtered neighbors would feel
                        random against the unfiltered list. */}
                    {(() => {
                      const fullIdx = fullModels.findIndex(m => m.id === model.id);
                      const canMoveUp = !isSearching && fullIdx > 0;
                      const canMoveDown = !isSearching && fullIdx >= 0 && fullIdx < fullModels.length - 1;
                      return (
                        <div className="flex flex-col shrink-0">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="h-4 w-4 -my-px"
                            disabled={!canMoveUp}
                            onClick={() => handleMove(provider.id, fullModels, fullIdx, -1)}
                            title={isSearching ? (isZh ? '搜索中暂不可用' : 'Disabled while searching') : undefined}
                          >
                            <CaretUp size={10} weight="bold" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="h-4 w-4 -my-px"
                            disabled={!canMoveDown}
                            onClick={() => handleMove(provider.id, fullModels, fullIdx, 1)}
                            title={isSearching ? (isZh ? '搜索中暂不可用' : 'Disabled while searching') : undefined}
                          >
                            <CaretDown size={10} weight="bold" />
                          </Button>
                        </div>
                      );
                    })()}

                    {/* Identity column */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {editing ? (
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <Input
                              value={draftDisplay}
                              onChange={(e) => setDraftDisplay(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename(provider.id, model.model_id);
                                if (e.key === 'Escape') setEditingDisplay(null);
                              }}
                              autoFocus
                              className="h-7 text-sm"
                            />
                            <Button variant="ghost" size="icon-xs" className="h-6 w-6 shrink-0" onClick={() => commitRename(provider.id, model.model_id)}>
                              <Check size={12} />
                            </Button>
                            <Button variant="ghost" size="icon-xs" className="h-6 w-6 shrink-0" onClick={() => setEditingDisplay(null)}>
                              <X size={12} />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <span className={cn("text-sm font-medium truncate", model.enabled === 0 && "text-muted-foreground line-through")}>
                              {model.display_name || model.model_id}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                              onClick={() => beginRename(provider.id, model)}
                              title={isZh ? '编辑显示名' : 'Rename'}
                            >
                              <PencilSimple size={11} />
                            </Button>
                          </>
                        )}
                        <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium', sourceTone)}>
                          {sourceLabel}
                        </span>
                        {model.user_edited === 1 && (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            {isZh ? '已编辑' : 'Edited'}
                          </span>
                        )}
                      </div>
                      {/* Three-concept identity rows. Without explicit
                          labels the bare strings (e.g. plain `sonnet`)
                          look like a model name; users couldn't tell
                          short aliases apart from real model IDs. Row
                          structure now distinguishes:
                            - upstream model ID  → what's actually sent
                              to the API
                            - Claude Code alias  → labelled when the
                              model_id is `sonnet` / `opus` / `haiku`
                            - last refresh       → when this row was
                              last synced from upstream */}
                      {(() => {
                        const isAlias = model.model_id === 'sonnet' || model.model_id === 'opus' || model.model_id === 'haiku';
                        const upstreamDiffers = !!model.upstream_model_id && model.upstream_model_id !== model.model_id;
                        return (
                          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground truncate">
                            {isAlias ? (
                              <span className="truncate">
                                <span>{isZh ? 'Claude Code 别名: ' : 'Claude Code alias: '}</span>
                                <span className="font-mono">{model.model_id}</span>
                              </span>
                            ) : (
                              <span className="truncate">
                                <span>{isZh ? '上游模型 ID: ' : 'Upstream ID: '}</span>
                                <span className="font-mono">{model.model_id}</span>
                              </span>
                            )}
                            {upstreamDiffers && (
                              <span className="truncate">
                                <span>{isZh ? '实际请求: ' : 'Actual: '}</span>
                                <span className="font-mono">{model.upstream_model_id}</span>
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        <span>{isZh ? '上次同步: ' : 'Last synced: '}</span>
                        {formatRefreshedAt(model.last_refreshed_at, isZh)}
                      </div>
                    </div>

                    {/* Enabled toggle */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={model.enabled === 1}
                        onCheckedChange={() => handleToggleEnabled(provider.id, model)}
                      />
                    </div>

                    {/* Delete (manual only) */}
                    {model.source === 'manual' ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => setDeleteTarget({ providerId: provider.id, modelId: model.model_id, name: model.display_name || model.model_id })}
                        title={isZh ? '删除此条' : 'Delete'}
                      >
                        <Trash size={14} />
                      </Button>
                    ) : (
                      <div className="size-8 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        );
      })}

      {/* Role mapping editor — one provider at a time. Each role is a Select
          over enabled models for that provider, plus a "清除" option. We
          show hidden models in the dropdown too (greyed out) so the user
          can see what they previously picked even if it's now hidden. */}
      <Dialog open={!!roleDialog} onOpenChange={(open) => { if (!open) setRoleDialog(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isZh ? `${roleDialog?.providerName} · 角色映射` : `${roleDialog?.providerName} · Role mapping`}
            </DialogTitle>
            <DialogDescription>
              {isZh
                ? '决定每个角色实际跑哪个模型。聊天里选「Sonnet」时这里指向谁就跑谁；留空表示这个角色没有专属模型。'
                : 'Decide which model fills each role. When chat picks "Sonnet" the runtime uses whatever you map here; leave blank to skip a role.'}
            </DialogDescription>
          </DialogHeader>
          {(() => {
            if (!roleDialog) return null;
            const provider = providers.find(p => p.id === roleDialog.providerId);
            if (!provider) return null;
            const allModels = bundles[provider.id] || [];
            return (
              <div className="space-y-3 mt-2 max-h-[60vh] overflow-y-auto">
                {ROLE_KEYS.map((role) => {
                  const value = roleDraft[role] || '';
                  const valueIsHidden = !!value && allModels.some(m => m.model_id === value && m.enabled === 0);
                  return (
                    <div key={role} className="rounded-md bg-muted/40 px-3.5 py-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-medium">
                            {isZh ? ROLE_LABEL_ZH[role] : ROLE_LABEL_EN[role]}
                            {valueIsHidden && (
                              <span className="ml-2 inline-flex items-center rounded-full bg-status-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-status-warning-foreground">
                                {isZh ? '已隐藏' : 'Hidden'}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {isZh ? ROLE_HINT_ZH[role] : ROLE_HINT_EN[role]}
                          </div>
                        </div>
                        <Select
                          value={value || '__unset__'}
                          onValueChange={(v) => setRoleDraft(prev => ({ ...prev, [role]: v === '__unset__' ? '' : v }))}
                        >
                          <SelectTrigger className="w-[200px] shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__unset__">{isZh ? '未设置' : 'Not set'}</SelectItem>
                            {/* Enabled rows first, hidden rows after — order
                                within each bucket follows the DB sort_order
                                already returned by getAllModelsForProvider.
                                Stable sort keeps the original ordering when
                                `enabled` ties, so users still see their own
                                Models-page reordering reflected here. */}
                            {[...allModels]
                              .sort((a, b) => (b.enabled ?? 0) - (a.enabled ?? 0))
                              .map(m => (
                                <SelectItem key={m.id} value={m.model_id}>
                                  {m.display_name || m.model_id}
                                  {m.enabled === 0 && (isZh ? ' (已隐藏)' : ' (hidden)')}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialog(null)} disabled={roleSaving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveRoles} disabled={roleSaving}>
              {roleSaving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存' : 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add manual model */}
      <Dialog open={!!addDialog} onOpenChange={(open) => { if (!open) setAddDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isZh ? `为「${addDialog?.providerName}」手动添加模型` : `Add model to ${addDialog?.providerName}`}</DialogTitle>
            <DialogDescription>
              {isZh
                ? '手动添加的模型来源标为「manual」，不会被刷新覆盖。'
                : 'Manually added models are tagged "manual" and survive future refreshes.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">{isZh ? '模型 ID' : 'Model ID'}</label>
              <Input
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="claude-sonnet-4-6"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">{isZh ? '显示名（可选）' : 'Display name (optional)'}</label>
              <Input
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder={isZh ? '留空则与模型 ID 相同' : 'Defaults to model ID'}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleAddModel} disabled={!newModelId.trim()}>
              {isZh ? '添加' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isZh ? '删除手动添加的模型' : 'Delete manual model'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isZh
                ? `确定要删除「${deleteTarget?.name}」吗？此操作不可撤销。`
                : `Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isZh ? '删除' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk toggle confirmation — large providers can have 100+ models;
          a single click to flip them all needs an explicit confirm so the
          action's weight matches its visual prominence. */}
      <AlertDialog open={!!bulkConfirm} onOpenChange={(open) => { if (!open) setBulkConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm?.target === 1
                ? (isZh ? '启用全部模型' : 'Enable all models')
                : (isZh ? '关闭全部模型' : 'Disable all models')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isZh
                ? `这会${bulkConfirm?.target === 1 ? '启用' : '关闭'}「${bulkConfirm?.providerName}」下的 ${bulkConfirm?.affected ?? 0} 个模型，操作可在每行单独还原。`
                : `This will ${bulkConfirm?.target === 1 ? 'enable' : 'disable'} ${bulkConfirm?.affected ?? 0} models under "${bulkConfirm?.providerName}". You can revert per row afterwards.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (bulkConfirm) {
                  handleBulkToggle(bulkConfirm.providerId, bulkConfirm.target);
                  setBulkConfirm(null);
                }
              }}
            >
              {bulkConfirm?.target === 1
                ? (isZh ? '全部启用' : 'Enable all')
                : (isZh ? '全部关闭' : 'Disable all')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Global align — confirm dialog */}
      <AlertDialog open={alignAllOpen} onOpenChange={(open) => {
        if (!open) {
          setAlignAllOpen(false);
          setAlignAllPhase('idle');
          setAlignPreview([]);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isZh ? '整理模型列表' : 'Tidy model list'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isZh
                ? '只保留每个服务商的推荐模型为启用，其余隐藏。下面是即将发生的变化预览，确认后再写入。'
                : 'Keep each provider\'s recommended models enabled and hide the rest. Preview below — nothing is written until you confirm.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-2">
            {alignAllPhase === 'previewing' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <SpinnerGap size={14} className="animate-spin" />
                {isZh ? '计算中…' : 'Computing…'}
              </div>
            )}
            {alignAllPhase !== 'previewing' && alignPreview.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">
                {isZh ? '没有可处理的服务商。' : 'No providers to align.'}
              </p>
            )}
            {alignAllPhase !== 'previewing' && alignPreview.length > 0 && (() => {
              const changed = alignPreview.filter(r => !r.skipped && (r.enabled + r.disabled + r.inserted + r.pruned) > 0);
              const unchanged = alignPreview.filter(r => !r.skipped && (r.enabled + r.disabled + r.inserted + r.pruned) === 0);
              const skipped = alignPreview.filter(r => r.skipped);
              const totals = changed.reduce((acc, r) => ({
                inserted: acc.inserted + r.inserted,
                enabled: acc.enabled + r.enabled,
                disabled: acc.disabled + r.disabled,
                pruned: acc.pruned + r.pruned,
              }), { inserted: 0, enabled: 0, disabled: 0, pruned: 0 });
              return (
                <div className="space-y-3">
                  <div className="rounded-md border border-border/50 bg-card">
                    <div className="px-4 divide-y divide-border/50">
                      {([
                        { label: isZh ? '插入' : 'Insert', value: totals.inserted },
                        { label: isZh ? '启用' : 'Enable', value: totals.enabled },
                        { label: isZh ? '隐藏' : 'Hide', value: totals.disabled },
                        { label: isZh ? '删除目录种子' : 'Prune catalog seeds', value: totals.pruned },
                      ]).map((item) => (
                        <div key={item.label} className="py-2.5 flex items-center justify-between gap-3">
                          <span className="text-[11px] text-muted-foreground">{item.label}</span>
                          <span className="text-xs font-medium text-foreground/85 tabular-nums">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {changed.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-md bg-muted/40 px-3 py-2 text-[11px] space-y-1">
                      {changed.map(r => (
                        <div key={r.providerId} className="flex items-center justify-between gap-2">
                          <span className="truncate">{r.providerName}</span>
                          <span className="text-muted-foreground font-mono text-[10px] shrink-0">
                            {r.inserted ? `+${r.inserted} ` : ''}
                            {r.enabled ? `↑${r.enabled} ` : ''}
                            {r.disabled ? `↓${r.disabled} ` : ''}
                            {r.pruned ? `−${r.pruned}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(unchanged.length > 0 || skipped.length > 0) && (
                    <p className="text-[11px] text-muted-foreground">
                      {isZh
                        ? `${unchanged.length} 个服务商无变化${skipped.length ? `，${skipped.length} 个无目录已跳过` : ''}`
                        : `${unchanged.length} unchanged${skipped.length ? `, ${skipped.length} skipped (no catalog)` : ''}`}
                    </p>
                  )}
                </div>
              );
            })()}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={alignAllPhase === 'applying'}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAlignAll}
              disabled={alignAllPhase !== 'preview-ready'}
            >
              {alignAllPhase === 'applying'
                ? (isZh ? '应用中…' : 'Applying…')
                : alignAllPhase === 'previewing'
                  ? (isZh ? '加载中…' : 'Loading…')
                  : (isZh ? '应用' : 'Apply')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
