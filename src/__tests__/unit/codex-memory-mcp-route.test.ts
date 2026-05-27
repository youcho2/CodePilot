/**
 * Phase 8 — CodePilot built-in MCP servers served to Codex over the generic
 * streamable-HTTP route (/api/codex/mcp/[server]). Phase 1 (memory) + #31 (widget).
 *
 * Run: npx tsx --test src/__tests__/unit/codex-memory-mcp-route.test.ts
 *
 * Concerns:
 *  (a) REUSE: routes mount the SAME createSdkMcpServer the ClaudeCode path
 *      uses (no duplicated tool logic) — proven via an in-memory MCP client.
 *  (b) ROUTE: the generic POST handler authorizes per-server (memory scoped
 *      to the configured workspace; widget open) and answers initialize.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMemorySearchMcpServer } from '@/lib/memory-search-mcp';
import { createWidgetMcpServer } from '@/lib/widget-guidelines';
import { POST } from '@/app/api/codex/mcp/[server]/route';
import { getSetting, setSetting } from '@/lib/db';

let ws: string;
let otherWs: string;
let priorAssistantWs: string | undefined;
before(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mem-mcp-'));
  fs.writeFileSync(path.join(ws, 'memory.md'), '# Long-term\nMEMTEST_MARKER preferred language is Chinese.\n', 'utf-8');
  otherWs = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mem-other-'));
  fs.writeFileSync(path.join(otherWs, 'memory.md'), 'SECRET other-workspace memory\n', 'utf-8');
  priorAssistantWs = getSetting('assistant_workspace_path');
  setSetting('assistant_workspace_path', ws);
});
after(() => {
  setSetting('assistant_workspace_path', priorAssistantWs ?? '');
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(otherWs, { recursive: true, force: true });
});

const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1.0' } },
});

function callRoute(server: string, headers: Record<string, string>, body = INIT_BODY) {
  const req = new Request(`http://local/api/codex/mcp/${server}`, { method: 'POST', headers, body });
  return POST(req as never, { params: Promise.resolve({ server }) });
}

describe('built-in MCP reuse (in-memory)', () => {
  it('memory: exposes the 3 ClaudeCode tools and reads the workspace', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const { instance } = createMemorySearchMcpServer(ws);
    await instance.connect(serverT);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientT);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ['codepilot_memory_get', 'codepilot_memory_recent', 'codepilot_memory_search']);
    const recent = await client.callTool({ name: 'codepilot_memory_recent', arguments: {} });
    assert.match((recent.content as { text: string }[])[0]?.text ?? '', /MEMTEST_MARKER/);
    await client.close();
    await instance.close();
  });

  it('widget: exposes codepilot_load_widget_guidelines', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const { instance } = createWidgetMcpServer();
    await instance.connect(serverT);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientT);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(tools.includes('codepilot_load_widget_guidelines'));
    await client.close();
    await instance.close();
  });
});

describe('built-in MCP route — /api/codex/mcp/[server]', () => {
  const accept = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

  it('unknown server → 404', async () => {
    const res = await callRoute('nope', accept);
    assert.equal(res.status, 404);
  });

  it('memory without/with wrong workspace → 403 (scoped to configured workspace)', async () => {
    assert.equal((await callRoute('codepilot_memory', accept)).status, 403); // no header
    assert.equal(
      (await callRoute('codepilot_memory', { ...accept, 'x-codepilot-workspace-path': otherWs })).status,
      403, // attacker-chosen dir
    );
  });

  it('memory with the configured workspace → 200 initialize', async () => {
    const res = await callRoute('codepilot_memory', { ...accept, 'x-codepilot-workspace-path': ws });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { result?: { serverInfo?: { name?: string } }; error?: unknown };
    assert.equal(json.error, undefined);
    assert.equal(json.result?.serverInfo?.name, 'codepilot-memory');
  });

  it('widget → 200 initialize WITHOUT a workspace header (no file access, not scoped)', async () => {
    const res = await callRoute('codepilot_widget', accept);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { result?: { serverInfo?: { name?: string } }; error?: unknown };
    assert.equal(json.error, undefined);
    assert.equal(json.result?.serverInfo?.name, 'codepilot-widget-guidelines');
  });
});
