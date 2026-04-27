---
name: CodePilot
description: Multi-model AI Agent desktop client. Settings shell — bordered cards, inset dividers, charcoal monochrome accent.
version: 0.2-settings-providers-models
colors:
  primary: "#252525"
  primary-foreground: "#FAFAF9"
  background: "#FFFFFF"
  foreground: "#1A1816"
  card: "#FFFFFF"
  card-foreground: "#1A1816"
  muted: "#F0EEEB"
  muted-foreground: "#857F75"
  accent: "#F0EEEB"
  border: "#E6E1DB"
  border-soft: "#E6E1DB80"        # border-border/50 — the default for display cards
  input: "#E6E1DB"
  ring: "#252525"
  destructive: "#DC2626"
  status-success: "#16A34A"
  status-success-muted: "#DCFCE7"
  status-warning: "#EA580C"
  status-warning-muted: "#FFEDD5"
  status-error: "#DC2626"
  status-error-muted: "#FEE2E2"
typography:
  page-title:
    family: Geist
    size: 0.875rem               # text-sm
    weight: 500
  section-label:
    family: Geist
    size: 0.6875rem              # text-[11px]
    weight: 500
    transform: uppercase
    tracking: wider
    color: muted-foreground
  body:
    family: Geist
    size: 0.8125rem              # text-[13px]
    weight: 400
  caption:
    family: Geist
    size: 0.6875rem              # text-[11px]
    weight: 400
    color: muted-foreground
  meta:
    family: Geist
    size: 0.625rem               # text-[10px]
    color: muted-foreground
rounded:
  sm: 4px                        # rounded-sm — segmented control inner buttons
  md: 6px                        # rounded-md — sub-cards, icon containers, image-family rows
  lg: 8px                        # rounded-lg — outer display cards (canonical card radius)
  full: 9999px                   # status pills, dot indicators
spacing:
  page:
    container: max-w-4xl mx-auto
    section-gap: 40px            # space-y-10  — between top-level sections
    block-gap: 24px              # space-y-6   — within a section
    row-gap: 12px                # space-y-3   — header → grid
  card:
    padding: 20px                # p-5
    inner-gap: 16px              # gap-4 (column)
  inset-divider-padding: 20px    # px-5 inside the wrapper that hosts `divide-y` so dividers don't touch the rounded edge
---

# CodePilot Settings Design

Concrete patterns extracted from `Settings > Providers` and `Settings > Models`. Anything in here is implemented and shipping; treat it as the canonical surface for new Settings work.

## Page shell

Every Settings sub-page uses the same outer container:

```tsx
<div className="max-w-4xl mx-auto space-y-10">
  <Section />
  <Section />
</div>
```

- **`max-w-4xl`** = 896px. All five Settings sub-pages share this.
- **`mx-auto`** centers horizontally. Don't left-align.
- **`space-y-10`** (40px) between top-level sections gives Luma-style breathing room.
- Within a section: `space-y-6` (24px) for header → body, `space-y-3` (12px) for sub-blocks.

## Card system

The single rule for display cards:

```tsx
<div className="rounded-lg bg-card border border-border/50 p-5">
  …content…
</div>
```

- **`rounded-lg`** (8px). Not `rounded-2xl`, not `rounded-3xl`. Outer cards are medium-radius.
- **`border border-border/50`** — softened, not solid `border-border`. The deeper border felt heavy.
- **`bg-card`** — same base as the page background; the border is what makes the card visible.
- **No shadow** by default. Shadows imply depth this surface doesn't earn.
- Padding `p-5`. Section 0-style strip cards use `px-5 py-4` (less vertical for single rows).

### Sub-card (nested content)

When a card holds a list-of-rows or a metadata block, the inner block uses:

```tsx
<div className="rounded-md bg-muted/40">
  <div className="px-3.5 divide-y divide-border/50">
    {rows.map(r => <div className="py-2.5 flex items-center justify-between">{…}</div>)}
  </div>
</div>
```

- **`rounded-md`** (6px) — one step smaller than the outer card, preserves hierarchy.
- **`bg-muted/40`** — distinct from `bg-card` so the user perceives it as a child block.
- **Inset dividers are mandatory**: `divide-y` lives on a `px-3.5` wrapper, not on the outer rounded box. This is what gives the "doesn't touch the edge" look.

The same inset-divider rule applies to outer cards that host stacked rows (e.g. the Service Settings card with diagnostics + default model):

```tsx
<div className="rounded-lg bg-card border border-border/50">
  <div className="px-5 divide-y divide-border/50">
    <div className="py-4 …">…row 1…</div>
    <div className="py-4 …">…row 2…</div>
  </div>
</div>
```

## Status & source badges

Two distinct dialects, same shape, different intent.

### Status pill — provider runtime state

```tsx
<span className={cn(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
  STATUS_TONE[data.status],
)}>
  <span className={cn("size-1.5 rounded-full", DOT_TONE[data.status])} />
  {label}
</span>
```

| Status | Background | Dot |
|---|---|---|
| `available` | `bg-status-success-muted text-status-success-foreground` | success-foreground |
| `needs-config` | `bg-status-warning-muted text-status-warning-foreground` | warning-foreground |
| `error` | `bg-status-error-muted text-status-error-foreground` | error-foreground |
| `unknown` | `bg-muted text-muted-foreground` | muted-foreground |

### Source badge — model lineage

Smaller (`text-[10px]`), no dot. Used on every row in `Settings > Models`.

| Source | Tone | When |
|---|---|---|
| `api` | `bg-status-success-muted text-status-success-foreground` | discovered via /v1/models or models.list |
| `catalog` | `bg-muted text-muted-foreground` | shipped from VENDOR_PRESETS |
| `manual` | `bg-primary/10 text-primary` | user hand-entered |
| `role_mapping` | `bg-status-warning-muted text-status-warning-foreground` | implied by `model_mapping` |
| `sdk_default` | `bg-muted text-muted-foreground` | hard-coded SDK fallback |

### `已编辑` chip

`bg-primary/10 text-primary` — same tone as `manual`. Signals "user touched this row, refresh will preserve user-controllable fields".

## Header rhythm

Provider section header (count + bulk + add):

```
[icon] Provider Name   3 / 10 启用                        [全部关闭] [全部启用] [+ 添加模型]
```

Rules:
- **Counts go next to the title**, not on the right. Bulk actions live on the right.
- **`X / Y 启用`** when not searching, **`X / Y 匹配`** when searching. Switch the suffix, not the format.
- **Bulk-toggle and reorder are disabled while searching** + tooltip — would otherwise hit the unfiltered list.
- **Primary "Add" button on the far right**, outline variant. Adding is distinct from the muted bulk-toggles.

## Visible vs kebab actions

Decide by frequency, not by cleanliness.

**Visible inline buttons (text or icon+text):**
- Edit
- Disconnect
- Refresh models  ← was kebab, promoted because discoverability matters for the diff flow
- Primary action: Login (OAuth), Settings link (env-managed), "Set as default" (image families)

**Kebab (`DotsThree`) only:**
- Diagnose
- Sync to Claude Code
- Anything < 5% usage

**Always:** kebab trigger needs `aria-label` + `title`.

## Filter tabs (segmented control)

Used for `enabled / hidden / all` on the Models page:

```tsx
<div className="inline-flex items-center rounded-md bg-muted p-0.5">
  {options.map(opt => (
    <button
      onClick={() => setFilter(opt.key)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {opt.label}
      <span className="text-[10px] tabular-nums">{opt.count}</span>
    </button>
  ))}
</div>
```

- **Default to the most useful filter**, not "all". Models page defaults to `enabled` because that's "what's actually exposed to chat".
- Counts must use `tabular-nums` so digits don't jitter as filters change.
- Don't reach for a heavyweight `<Tabs>` component if it co-locates with other controls — keep it inline.

## Search

```tsx
<div className="relative flex-1">
  <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
  <Input className="pl-9" placeholder="搜索…" />
</div>
```

- Icon `pointer-events-none` so clicks always reach the input.
- Search is composable: filters apply first, search filters within the result.

## When to preview, when to silently auto-apply

Two separate apply paths in this codebase, with different UX rules:

### A. Conservative auto-apply (no preview dialog)

Used by:
- **Add Service** success → auto-discover the new provider's models
- Per-provider **"刷新"** button on Models page section header
- Page-top **"刷新全部"** batch driver

Why no preview: the apply layer (`applyDiscoveryDiff` in `db.ts`) reads
each row's `enable_source` and refuses to flip rows in
`manual_enabled` / `manual_hidden`. New rows land enabled only if the
recommendation list says so; everything else hides. So a silent refresh
can never override a user choice — the protection is in the data
layer, not the UI gate.

A toast (single-provider, or rolling progress for batch) reports the
outcome — `recommendedEnabled` / `discoveredHidden` counts; the user
gets a 1-line summary instead of a 3-step dialog.

### B. Preview-then-apply (dialog)

Used by:
- **"按推荐整理"** (Tidy by recommended — `alignEnabledWithCatalog`)
- The advanced diff dialog accessed from `ProviderManager.handleDiscoverModels`
  (legacy, kept for orphan review and forced resets)

Why preview: these flows can intentionally flip many rows or produce
permanent deletes (catalog seed pruning); the user needs to see scope
before committing.

Implementation in three phases of a dialog:

1. `previewing` — spinner + "Computing…"
2. `preview-ready` — show counts + per-target breakdown + Apply button
3. `applying` — Apply disabled, "Applying…", close on completion

Rules:
- Preview must be **idempotent** server-side (no DB writes during dryRun).
- The same code path computes the preview and the apply — never let them diverge.
- Counts are surfaced as a 4-row sub-card (Insert / Enable / Hide / Prune). Per-target deltas use ASCII glyphs (`+ ↑ ↓ −`) in monospace for scan-ability.
- Skipped targets (no catalog, no upstream support) get a plain text footnote, not their own row.

## Empty states

```tsx
<div className="rounded-lg border border-border/50 bg-card p-10 flex flex-col items-center text-center gap-3">
  <div className="text-sm font-medium">{title}</div>
  <div className="text-xs text-muted-foreground max-w-md">{body}</div>
  <Button variant="default" size="sm" className="gap-1.5 mt-1">
    <Plus size={14} weight="bold" />
    {primaryAction}
  </Button>
</div>
```

- One sentence title (`text-sm font-medium`).
- One paragraph body (`text-xs text-muted-foreground`), capped at `max-w-md`.
- One primary action — solid (default) variant. Empty state is the moment the page exists for; this is the right place for the loud button.
- `p-10` for generous breathing room.

## Modal / fullscreen dialogs

Two flavors via the shared `DialogContent` component:

- **Centered modal** (default) — confirms, small forms, info dialogs.
- **Fullscreen takeover** (`fullscreen` prop) — for Add Service, Connect Provider, Edit Provider. Forms get the user's full attention; the underlying surface is replaced with `bg-background`, the form content lives in a `min-h-full flex items-center justify-center` wrapper so it stays vertically centered.

Both flavors render a circular close button top-right (built in to `DialogContent`).

## Runtime Compatibility Matrix

Single source of truth for "where does this model belong": `src/lib/runtime-compat.ts`. Provider-layer compat is computed once via `getProviderCompat()` and consumed by:

| Consumer | What it does with compat |
|---|---|
| Provider Card | Renders a second pill in the header next to status pill |
| Models page | Shows compat badge on every row + Runtime filter dropdown gates whole sections |
| `/api/providers/models` | Returns `compat` per group so chat picker can filter / badge |
| provider-resolver | (Phase 2) skip models whose compat doesn't match active runtime |

### Provider-layer states

| State | When | Pill tone |
|---|---|---|
| `claude_code_ready` | `anthropic-official` / `bedrock` / `vertex` preset, env-detected Claude Code | success |
| `claude_code_experimental` | Anthropic-protocol brands & relays (anthropic-thirdparty, kimi, glm, moonshot, minimax, volcengine, xiaomi-mimo, bailian, deepseek, ollama, litellm) | warning |
| `codepilot_only` | OpenRouter / OpenAI-compat / Google chat — non-Anthropic protocol | primary/10 |
| `media_only` | image-image protocols | muted |
| `unknown` | Custom URL with no preset match — UI says "需验证", never "不可用" | muted |

### Model-layer flags

A bag of capability flags (multiple can apply). Used for finer-grained gating:

- `chat` — usable as chat / coding model
- `tool_capable` — known to support tool calls (defaults true unless catalog says otherwise)
- `thinking_capable` — supports reasoning / effort levels
- `claude_code_compatible` — surfaceable when current runtime is Claude Code
- `codepilot_runtime_compatible` — surfaceable when current runtime is CodePilot Runtime
- `media` — image / video / embedding only; never enters chat picker

Computed via `getModelCompat({ modelId, providerCompat, capabilities })`. Claude-alias rows (`sonnet` / `opus` / `haiku` / `claude-*`) auto-get `claude_code_compatible` even on `codepilot_only` providers — relays often expose Anthropic models too.

### Filter precedence (when consumed)

1. **Hidden** (`enabled=0` in `provider_models`) wins over everything. Catalog fallback / role default / env injection all check `dbHiddenIds` first.
2. **Runtime filter** then narrows by Provider compat. `unknown` stays visible across runtimes — copy is "需验证", not "incompatible".
3. **Media** is never in chat surfaces, regardless of filter.

### Wording lock

Use `compatLabel(compat, isZh)` from `runtime-compat.ts` everywhere. Don't hard-code Chinese strings in components — a future copy change must touch one file.

## What `Settings > Models` is for

The Models page is the source of truth for "which models reach the chat picker / runtime". Providers can advertise hundreds of models; users decide which they actually want.

Hard rules baked into the implementation:
- Hiding a model in Models page **must** suppress it in `/api/providers/models` (the picker feed) and in `provider-resolver.ts` (the runtime). The catalog fallback respects user-set hidden ids.
- Refresh from a Provider card never auto-applies — it shows a diff and waits for the user.
- Align-with-catalog is preview-first too; same dryRun → confirm → apply contract.
- User-edited rows (`user_edited=1`) survive every refresh / align: display_name, capabilities, and especially `enabled=0` are preserved.

## Counts on the Provider card

The "Models" row on each Provider card shows `enabled / total`, where:

- **enabled** = rows the chat picker actually surfaces.
- **total** = `total_count` from `/api/providers/models` — i.e. all `provider_models` rows for this provider, including hidden ones. Falls back to catalog size when the table is empty.

Don't display only the enabled count — users hide things and need to remember they did. Don't display only total — they need to know how many are actually exposed. The "X / Y" form is non-negotiable.

## Do / Don't

✅ **Do**
- Use `border border-border/50` for display cards. Soft, not heavy.
- Inset dividers via `px-N + divide-y` wrapper. Never `divide-y` directly on a rounded card.
- Mirror the page-shell radius hierarchy: outer `rounded-lg`, nested `rounded-md`, micro chips `rounded-full`.
- Show counts as `enabled / total` when both are interesting. Don't pick one.
- `aria-label` every icon-only button.
- Use `tabular-nums` on numeric counts that change.
- Auto-apply silently when the data layer protects against override (refresh paths under `enable_source` guard); show a preview dialog only when the operation can intentionally flip many user choices ("按推荐整理") or perform deletes.

❌ **Don't**
- Don't put a preview dialog in front of every write — single-provider refresh + batch refresh-all auto-apply on purpose; gating them behind a dialog regresses the UX. Reserve previews for the Tidy / advanced-diff paths where the user is asking for a sweeping change.
- Don't add an apply path that ignores `enable_source IN ('manual_enabled','manual_hidden')` — that's the invariant that makes silent refresh safe in the first place.
- Don't bury the most-used action in a kebab. If a user needs it weekly, surface it.
- Don't display the same list as both "all models" and "what the picker shows" — they diverge once the user starts hiding things, and the picker view is the lie.
- Don't toggle `loading=true` on a soft refresh — it remounts the list and loses scroll position.
- Don't dispatch a global `provider-changed` from inside the page that listens for it; it's a feedback loop with a flicker.
- Don't use `border-border` (full-strength) for cards — that's reserved for inputs where contrast aids hit-testing.
- Don't assume `total_count` equals catalog size — for providers with API-discovered rows, total includes hidden ones.
- Don't auto-enable models the user has hidden. Refresh apply must respect `user_edited=1` AND `enable_source IN ('manual_enabled','manual_hidden')` — both are required, the legacy flag protects pre-Phase-B rows.

## Anchor implementations

| Pattern | File |
|---|---|
| Settings shell + nav | `src/components/settings/SettingsLayout.tsx` |
| Page-level container width (5 sub-pages) | `src/components/settings/{ProviderManager,ModelsSection,GeneralSection,CliSettingsSection,UsageStatsSection,AssistantWorkspaceSection}.tsx` |
| Outer card | `ProviderCard.tsx` (`rounded-lg bg-card border border-border/50 p-5`) |
| Inset divider sub-card | `ProviderCard.tsx` info section (`rounded-md bg-muted/40` + `px-3.5 divide-y divide-border/50`) |
| Section 0 stacked card | `ProviderManager.tsx` 「服务设置」block |
| Status pill with dot | `ProviderCard.tsx` header |
| Source badge | `ModelsSection.tsx` (`SOURCE_TONE`) |
| Filter segmented control | `ModelsSection.tsx` (Models page header) |
| Search input | `ModelsSection.tsx` |
| Bulk-action header | `ModelsSection.tsx` (per-provider header) |
| Confirm-then-apply (diff) | `ProviderManager.tsx` (refresh dialog) + `ModelsSection.tsx` (align dialog) |
| Empty state | `ProviderManager.tsx` (no providers connected) |
| Fullscreen dialog | `src/components/ui/dialog.tsx` (`fullscreen` prop) + `PresetConnectDialog.tsx`, `ProviderForm.tsx` |
| Visible inline kebab demotion | `ProviderCard.tsx` (Refresh promoted out, Diagnose stays in) |
| Runtime compat matrix | `src/lib/runtime-compat.ts` (`getProviderCompat`, `getModelCompat`, `compatLabel`, `compatTone`) |
| Provider compat pill | `ProviderCard.tsx` header (second pill via `data.compat`) |
| Per-row compat badge | `ModelsSection.tsx` (next to source badge in row label) |
| Runtime filter dropdown | `ModelsSection.tsx` (alongside enabled/hidden tabs + search) |
