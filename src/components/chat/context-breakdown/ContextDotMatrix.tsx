'use client';

/**
 * Phase 6 Phase 2b — dot-matrix main bar for the chat Context popover.
 *
 * Renders 100 cells (2 rows × 50) representing the breakdown by category.
 * Each cell is one of:
 *   - colored fill: a category's allocated share of the context window
 *     (background-color comes from --context-dot-{kebab-kind} in globals.css)
 *   - dashed outline + transparent fill: pending share (files_attachments /
 *     pending_next_turn) — "what would join the next turn"
 *   - muted empty fill: remaining capacity (only when contextWindow known)
 *
 * Cell allocation rules:
 *   - Denominator: contextWindow when known; otherwise usedTokens + pendingTotal
 *   - Each non-zero part rounds to ceil(tokens / denominator * cellCount), so
 *     a kind with a tiny non-zero share still shows at least one cell
 *   - Cells render in CONTEXT_BREAKDOWN_KIND_ORDER so the color stripe is
 *     stable across renders
 *   - Pending cells render after the used cells (visually distinct via
 *     dashed border) but before the empty cells
 *
 * Sub-component of ContextUsageIndicator / RunCockpitPopoverContent — not a
 * standalone mount surface.
 */

import type {
  ContextBreakdownKind,
  ContextUsageBreakdown,
} from '@/lib/context-breakdown';
import {
  CONTEXT_BREAKDOWN_KIND_ORDER,
  PENDING_BREAKDOWN_KINDS,
} from '@/lib/context-breakdown';
import { cn } from '@/lib/utils';

const PENDING_SET = new Set<ContextBreakdownKind>(PENDING_BREAKDOWN_KINDS);

function dotVar(kind: ContextBreakdownKind): string {
  return `var(--context-dot-${kind.replace(/_/g, '-')})`;
}

interface CellAllocation {
  kind: ContextBreakdownKind;
  cells: number;
  isPending: boolean;
}

function computeAllocations(
  breakdown: ContextUsageBreakdown,
  cellCount: number,
): { cells: CellAllocation[]; emptyCells: number } {
  const partsByKind = new Map(
    breakdown.parts.map((p) => [p.kind, p] as const),
  );

  // Denominator decides what one cell represents.
  // When contextWindow is known: 1 cell = contextWindow / cellCount tokens.
  // When unknown: distribute by usedTokens + pendingTotal (no empty cells).
  const pendingTotal = breakdown.parts
    .filter((p) => PENDING_SET.has(p.kind))
    .reduce((s, p) => s + p.tokens, 0);
  const windowKnown =
    typeof breakdown.contextWindow === 'number' && breakdown.contextWindow > 0;
  const denominator = windowKnown
    ? (breakdown.contextWindow as number)
    : breakdown.usedTokens + pendingTotal;

  if (denominator <= 0) return { cells: [], emptyCells: cellCount };

  const allocations: CellAllocation[] = [];
  let totalAllocated = 0;

  // First pass: used kinds in stable order.
  for (const kind of CONTEXT_BREAKDOWN_KIND_ORDER) {
    if (PENDING_SET.has(kind)) continue;
    const part = partsByKind.get(kind);
    if (!part || part.tokens <= 0) continue;
    // ceil so a tiny non-zero share still surfaces as 1 cell.
    const raw = (part.tokens / denominator) * cellCount;
    const cells = Math.max(1, Math.ceil(raw));
    allocations.push({ kind, cells, isPending: false });
    totalAllocated += cells;
  }

  // Second pass: pending kinds.
  for (const kind of CONTEXT_BREAKDOWN_KIND_ORDER) {
    if (!PENDING_SET.has(kind)) continue;
    const part = partsByKind.get(kind);
    if (!part || part.tokens <= 0) continue;
    const raw = (part.tokens / denominator) * cellCount;
    const cells = Math.max(1, Math.ceil(raw));
    allocations.push({ kind, cells, isPending: true });
    totalAllocated += cells;
  }

  // Cap at cellCount in case rounding overshoots; trim from the end.
  if (totalAllocated > cellCount) {
    let overshoot = totalAllocated - cellCount;
    for (let i = allocations.length - 1; i >= 0 && overshoot > 0; i--) {
      const take = Math.min(overshoot, allocations[i].cells);
      allocations[i].cells -= take;
      overshoot -= take;
    }
    // Drop any zero-cell entries left behind.
    return {
      cells: allocations.filter((a) => a.cells > 0),
      emptyCells: 0,
    };
  }

  return { cells: allocations, emptyCells: cellCount - totalAllocated };
}

export interface ContextDotMatrixProps {
  breakdown: ContextUsageBreakdown;
  /** Total number of cells. Default 100 (2 rows × 50 with columnsPerRow). */
  cellCount?: number;
  /** Cells per row. Default 50 → grid auto-wraps to 2 rows at cellCount=100. */
  columnsPerRow?: number;
  className?: string;
}

export function ContextDotMatrix({
  breakdown,
  cellCount = 100,
  columnsPerRow = 50,
  className,
}: ContextDotMatrixProps) {
  const { cells: allocations, emptyCells } = computeAllocations(
    breakdown,
    cellCount,
  );

  if (allocations.length === 0 && emptyCells === 0) return null;

  return (
    <div
      aria-hidden
      className={cn('grid gap-px', className)}
      style={{
        gridTemplateColumns: `repeat(${columnsPerRow}, minmax(0, 1fr))`,
      }}
    >
      {allocations.flatMap((alloc) =>
        Array.from({ length: alloc.cells }, (_, i) => (
          <span
            key={`${alloc.kind}-${i}`}
            className={cn(
              'aspect-square rounded-[2px]',
              alloc.isPending &&
                'border border-dashed border-muted-foreground bg-transparent',
            )}
            style={
              alloc.isPending
                ? undefined
                : { backgroundColor: dotVar(alloc.kind) }
            }
          />
        )),
      )}
      {Array.from({ length: emptyCells }, (_, i) => (
        <span
          key={`empty-${i}`}
          className="aspect-square rounded-[2px] bg-muted/60"
        />
      ))}
    </div>
  );
}
