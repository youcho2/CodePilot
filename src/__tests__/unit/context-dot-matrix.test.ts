/**
 * ContextDotMatrix.computeAllocations regression tests.
 *
 * Pins the v8 fix (2026-05-20): mini-bar (cellCount=10, minCellsPerKind=0)
 * must NOT inflate non-zero categories to 1 cell each. User reported "50%
 * 上下文占用时点阵就已经全满" — root cause was Math.max(1, ceil) forcing
 * every small category to take 1 cell out of only 10.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeAllocations } from '../../components/chat/context-breakdown/ContextDotMatrix';
import type { ContextUsageBreakdown } from '../../lib/context-breakdown';

function makeBreakdown(parts: Array<{ kind: string; tokens: number }>, contextWindow = 200000): ContextUsageBreakdown {
  return {
    parts: parts.map((p) => ({ ...p, label: p.kind, source: 'test' })) as ContextUsageBreakdown['parts'],
    usedTokens: parts.reduce((s, p) => s + p.tokens, 0),
    contextWindow,
  } as ContextUsageBreakdown;
}

describe('ContextDotMatrix.computeAllocations — minCellsPerKind: 0 (mini-bar)', () => {
  it('5 tiny categories at ~2% each on 10-cell bar → most disappear (no force-1), bar reflects ~10% real fill', () => {
    // 5 categories × 2% = 10% total used. With minCellsPerKind=1 (old behavior),
    // this would assign 5 cells (50% fill). With minCellsPerKind=0, each rounds
    // to round(0.2) = 0 cell, so they vanish; total fill = 0–1 cells.
    const breakdown = makeBreakdown(
      [
        { kind: 'tools', tokens: 4000 },
        { kind: 'mcp', tokens: 4000 },
        { kind: 'skills', tokens: 4000 },
        { kind: 'rules', tokens: 4000 },
        { kind: 'system_prompt', tokens: 4000 },
      ],
      200_000,
    );
    const { cells, emptyCells } = computeAllocations(breakdown, 10, 0);
    const filled = cells.reduce((s, c) => s + c.cells, 0);
    assert.ok(filled <= 2, `mini-bar should reflect ~10% real fill, got ${filled} filled cells (${cells.length} categories)`);
    assert.equal(filled + emptyCells, 10);
  });

  it('1 category at 50% on 10-cell bar → exactly 5 filled cells', () => {
    const breakdown = makeBreakdown(
      [{ kind: 'conversation', tokens: 100_000 }],
      200_000,
    );
    const { cells, emptyCells } = computeAllocations(breakdown, 10, 0);
    const filled = cells.reduce((s, c) => s + c.cells, 0);
    assert.equal(filled, 5);
    assert.equal(emptyCells, 5);
  });

  it('1 category at 0.4% on 10-cell bar → 0 filled cells (disappears, no min-1 inflation)', () => {
    const breakdown = makeBreakdown(
      [{ kind: 'rules', tokens: 800 }],
      200_000,
    );
    const { cells, emptyCells } = computeAllocations(breakdown, 10, 0);
    assert.equal(cells.length, 0);
    assert.equal(emptyCells, 10);
  });
});

describe('ContextDotMatrix.computeAllocations — minCellsPerKind: 1 (popover default, unchanged)', () => {
  it('5 tiny categories at ~2% on 100-cell popover → each surfaces 1 cell minimum', () => {
    const breakdown = makeBreakdown(
      [
        { kind: 'tools', tokens: 4000 },
        { kind: 'mcp', tokens: 4000 },
        { kind: 'skills', tokens: 4000 },
        { kind: 'rules', tokens: 4000 },
        { kind: 'system_prompt', tokens: 4000 },
      ],
      200_000,
    );
    const { cells } = computeAllocations(breakdown, 100, 1);
    // Each category should have at least 1 cell (legend match)
    for (const cell of cells) {
      assert.ok(cell.cells >= 1, `${cell.kind} got ${cell.cells} cells, expected ≥ 1 with minCellsPerKind=1`);
    }
    // 4000 / 200000 * 100 = 2 → ceil = 2 cells each
    const filled = cells.reduce((s, c) => s + c.cells, 0);
    assert.equal(filled, 10); // 5 × 2 = 10 cells out of 100
  });

  it('1 category at 0.4% on 100-cell popover → 1 cell (Math.max(1, ceil) kicks in)', () => {
    const breakdown = makeBreakdown(
      [{ kind: 'rules', tokens: 800 }],
      200_000,
    );
    const { cells } = computeAllocations(breakdown, 100, 1);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].cells, 1);
  });
});
