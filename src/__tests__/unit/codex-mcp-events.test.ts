/**
 * Phase 8 Phase 3 — Codex MCP event bridge.
 *
 * Run: npx tsx --test src/__tests__/unit/codex-mcp-events.test.ts
 *
 * Covers: MCP server startup success/failure surfacing (no longer silent),
 * MCP tool start + completed(success/error) → canonical tool events, and a
 * source pin on the runtime's safe-decline elicitation handler.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { translateCodexNotification } from '../../lib/codex/event-mapper';
import { decideCodexElicitation } from '../../lib/codex/mcp-elicitation';

const ctx = { sessionId: 'sess-1' } as const;

describe('mcpServer/startupStatus/updated — not silent', () => {
  it('failed → visible (non-terminal) diagnostic carrying the error', () => {
    const ev = translateCodexNotification(
      'mcpServer/startupStatus/updated',
      { name: 'codepilot_memory', status: 'failed', error: 'handshake failed' },
      ctx,
    );
    assert.ok(ev);
    assert.equal(ev!.type, 'unknown_item');
    const e = ev as { type: 'unknown_item'; sourceType: string; payload: { server: string; error: string } };
    assert.equal(e.sourceType, 'codex.mcpServerStartupFailed');
    assert.equal(e.payload.server, 'codepilot_memory');
    assert.equal(e.payload.error, 'handshake failed');
  });

  it('ready → lightweight visible status', () => {
    const ev = translateCodexNotification(
      'mcpServer/startupStatus/updated',
      { name: 'codepilot_memory', status: 'ready', error: null },
      ctx,
    );
    assert.equal(ev?.type, 'unknown_item');
    assert.equal((ev as { sourceType: string }).sourceType, 'codex.mcpServerReady');
  });

  it('starting (transient) → no event (avoid noise)', () => {
    const ev = translateCodexNotification(
      'mcpServer/startupStatus/updated',
      { name: 'codepilot_memory', status: 'starting', error: null },
      ctx,
    );
    assert.equal(ev, null);
  });
});

describe('mcpToolCall → canonical tool events', () => {
  it('item/started mcpToolCall → tool_started named server.tool', () => {
    const ev = translateCodexNotification(
      'item/started',
      { item: { id: 'i1', type: 'mcpToolCall', server: 'codepilot_memory', tool: 'memory_search', arguments: { query: 'x' } } },
      ctx,
    );
    assert.equal(ev?.type, 'tool_started');
    const e = ev as { type: 'tool_started'; toolId: string; name: string };
    assert.equal(e.name, 'codepilot_memory.memory_search');
    assert.equal(e.toolId, 'i1');
  });

  it('item/completed mcpToolCall failed → tool_completed WITH canonical error', () => {
    const ev = translateCodexNotification(
      'item/completed',
      { item: { id: 'i1', type: 'mcpToolCall', status: 'failed', error: { message: 'tool blew up' } } },
      ctx,
    );
    assert.equal(ev?.type, 'tool_completed');
    const e = ev as { type: 'tool_completed'; toolId: string; error?: string };
    assert.equal(e.error, 'tool blew up');
  });

  it('item/completed mcpToolCall success → tool_completed, no error', () => {
    const ev = translateCodexNotification(
      'item/completed',
      { item: { id: 'i1', type: 'mcpToolCall', status: 'completed', result: { content: [] } } },
      ctx,
    );
    assert.equal(ev?.type, 'tool_completed');
    assert.equal((ev as { error?: string }).error, undefined);
  });
});

describe('runtime elicitation handler (source pin)', () => {
  const runtimeSrc = fs.readFileSync(path.resolve(__dirname, '../../lib/codex/runtime.ts'), 'utf-8');

  it('registers mcpServer/elicitation/request and routes it through the pure policy', () => {
    assert.ok(runtimeSrc.includes("'mcpServer/elicitation/request'"), 'must register elicitation handler');
    assert.ok(runtimeSrc.includes('decideCodexElicitation'), 'handler must use the unit-tested elicitation policy');
  });
});

describe('decideCodexElicitation — behavior (Phase 5 root-cause guard)', () => {
  it('ACCEPTS the read-only built-in servers (memory + widget; else Codex rejects the call)', () => {
    for (const s of ['codepilot_memory', 'codepilot_widget']) {
      const r = decideCodexElicitation(s);
      assert.equal(r.action, 'accept', `${s} must accept`);
      assert.deepEqual(r.content, {});
    }
  });

  it('DECLINES any other server (never blanket-accept)', () => {
    for (const s of ['user_weather', 'chrome-devtools', 'some_mutating_server']) {
      assert.equal(decideCodexElicitation(s).action, 'decline', `${s} must decline`);
    }
  });

  it('DECLINES null / undefined server (safe default — guards against blanket-decline AND blanket-accept regressions)', () => {
    assert.equal(decideCodexElicitation(null).action, 'decline');
    assert.equal(decideCodexElicitation(undefined).action, 'decline');
  });
});
