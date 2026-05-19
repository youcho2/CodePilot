'use client';

/**
 * Phase 6 Phase 2a — 10-row breakdown list for the chat Context popover.
 *
 * Replaces the legacy ContextInputUsage / ContextOutputUsage / ContextCacheUsage
 * three-row block. Each row shows: color dot + user-facing label + token count
 * (right-aligned, tabular-nums for vertical alignment).
 *
 * Pending kinds (files_attachments / pending_next_turn) render with a dashed
 * outline + muted text so the user can tell "what would join the next turn"
 * apart from "already used".
 *
 * Dot colors come from `--context-dot-{kebab-kind}` CSS variables defined in
 * `src/app/globals.css`. Same OKLCH palette in light and dark theme.
 *
 * Subcomponent of ContextUsageIndicator / RunCockpitPopoverContent — not a
 * standalone mount surface (Phase 6 design: no third parallel entry).
 */

import type {
  ContextBreakdownPart,
  ContextUsageBreakdown,
} from '@/lib/context-breakdown';
import { PENDING_BREAKDOWN_KINDS } from '@/lib/context-breakdown';
import { cn } from '@/lib/utils';

const PENDING_SET = new Set<ContextBreakdownPart['kind']>(PENDING_BREAKDOWN_KINDS);

function dotVar(kind: ContextBreakdownPart['kind']): string {
  // Map kind enum (snake_case) to CSS variable (kebab-case).
  return `var(--context-dot-${kind.replace(/_/g, '-')})`;
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return String(n);
}

export interface ContextBreakdownListProps {
  breakdown: ContextUsageBreakdown;
  /** Hide rows whose tokens === 0. Default true. */
  hideZero?: boolean;
  className?: string;
}

export function ContextBreakdownList({
  breakdown,
  hideZero = true,
  className,
}: ContextBreakdownListProps) {
  const visibleParts = hideZero
    ? breakdown.parts.filter((p) => p.tokens > 0)
    : breakdown.parts;

  if (visibleParts.length === 0) return null;

  return (
    <ul className={cn('flex flex-col gap-1.5 text-xs', className)}>
      {visibleParts.map((part) => {
        const isPending = PENDING_SET.has(part.kind);
        return (
          <li
            key={part.kind}
            className={cn(
              'flex items-center justify-between gap-3',
              isPending && 'text-muted-foreground',
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'inline-block size-2.5 rounded-sm shrink-0',
                  isPending && 'border border-dashed border-muted-foreground bg-transparent',
                )}
                style={isPending ? undefined : { backgroundColor: dotVar(part.kind) }}
              />
              <span className="truncate text-foreground">{part.label}</span>
            </span>
            <span className="font-mono shrink-0 tabular-nums">
              {formatTokens(part.tokens)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
