/**
 * Phase 8 Phase 1 — CodePilot Memory MCP served to Codex over streamable HTTP.
 *
 * Run: npx tsx --test src/__tests__/unit/codex-memory-mcp-route.test.ts
 *
 * Two concerns:
 *  (a) REUSE: the route mounts the SAME `createMemorySearchMcpServer`
 *      instance the ClaudeCode path uses (no duplicated tool logic). Proven
 *      via an in-memory MCP client — 3 tools present + memory_recent reads
 *      the workspace.
 *  (b) ROUTE: the POST handler stands up the MCP transport and answers an
 *      `initialize`, and rejects a request with no workspace header.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMemorySearchMcpServer } from '@/lib/memory-search-mcp';
import { POST } from '@/app/api/codex/mcp/memory/route';
import { getSetting, setSetting } from '@/lib/db';

let ws: string;
let otherWs: string;
let priorAssistantWs: string | undefined;
before(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mem-mcp-'));
  fs.writeFileSync(path.join(ws, 'memory.md'), '# Long-term\nMEMTEST_MARKER preferred language is Chinese.\n', 'utf-8');
  otherWs = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mem-other-'));
  fs.writeFileSync(path.join(otherWs, 'memory.md'), 'SECRET other-workspace memory\n', 'utf-8');
  // The route only serves the configured assistant workspace.
  priorAssistantWs = getSetting('assistant_workspace_path');
  setSetting('assistant_workspace_path', ws);
});
after(() => {
  setSetting('assistant_workspace_path', priorAssistantWs ?? '');
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(otherWs, { recursive: true, force: true });
});

describe('Memory MCP reuse (in-memory)', () => {
  it('exposes the 3 ClaudeCode memory tools and reads the workspace', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const { instance } = createMemorySearchMcpServer(ws);
    await instance.connect(serverT);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientT);

    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, [
      'codepilot_memory_get',
      'codepilot_memory_recent',
      'codepilot_memory_search',
    ]);

    const recent = await client.callTool({ name: 'codepilot_memory_recent', arguments: {} });
    const text = (recent.content as { type: string; text: string }[])[0]?.text ?? '';
    assert.match(text, /MEMTEST_MARKER/);

    await client.close();
    await instance.close();
  });
});

describe('Memory MCP route (POST handler)', () => {
  it('rejects a request with no workspace header (400)', async () => {
    const res = await POST(
      new Request('http://local/api/codex/mcp/memory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }) as never,
    );
    assert.equal(res.status, 400);
  });

  it('rejects a workspace that is not the configured assistant workspace (403)', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1.0' } },
    });
    const res = await POST(
      new Request('http://local/api/codex/mcp/memory', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          // attacker-chosen directory, NOT the configured assistant workspace
          'x-codepilot-workspace-path': otherWs,
        },
        body,
      }) as never,
    );
    assert.equal(res.status, 403);
  });

  it('answers an MCP initialize over the streamable-HTTP transport', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1.0' } },
    });
    const res = await POST(
      new Request('http://local/api/codex/mcp/memory', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'x-codepilot-workspace-path': ws,
        },
        body,
      }) as never,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { result?: { serverInfo?: { name?: string } }; error?: unknown };
    assert.equal(json.error, undefined);
    assert.equal(json.result?.serverInfo?.name, 'codepilot-memory');
  });
});
