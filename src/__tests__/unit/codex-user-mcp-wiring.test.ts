/**
 * Phase 5e review round 4 fix P1 (2026-05-18) — Codex Runtime
 * **does not mount** CodePilot user MCP servers.
 *
 * Source-level guarantee that the User CodePilot Harness scanner
 * (which now marks `mcp_server` as `perception_only` on
 * `codex_runtime`) stays honest with the actual wire-up. If a future
 * commit adds real user-MCP injection to the Codex proxy, that
 * commit MUST also update `executableForKind` in
 * `user-codepilot-extensions.ts` to flip codex_runtime back to
 * executable — these two tests fail loudly in that case so the
 * reviewer knows to pair the change.
 *
 * The reverse path (mcp_server marked executable on codex_runtime)
 * is forbidden by the user-scanner test above; this file is the
 * complementary "Codex side has no wire-up" pin.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

// Files that comprise the Codex Runtime send path.
const CODEX_FILES = [
  'src/lib/codex/proxy/unified-adapter.ts',
  'src/lib/codex/proxy/builtin-bridge.ts',
  'src/lib/codex/proxy/builtin-event-bus.ts',
  'src/lib/codex/proxy/translate-input.ts',
  'src/lib/codex/proxy/translate-tools.ts',
  'src/lib/codex/proxy/translate-stream.ts',
  'src/lib/codex/proxy/translate-response.ts',
  'src/lib/codex/proxy/adapter.ts',
  'src/lib/codex/runtime.ts',
];

describe('Codex Runtime — does NOT mount CodePilot user MCP servers', () => {
  it('no Codex proxy file imports the MCP loaders', () => {
    const forbidden = [
      'buildMcpToolSet',
      'loadCodePilotMcpServers',
      'loadAllMcpServers',
      'loadProjectMcpServers',
    ];
    for (const rel of CODEX_FILES) {
      const src = readSrc(rel);
      for (const symbol of forbidden) {
        assert.equal(
          src.includes(symbol),
          false,
          `${rel} references "${symbol}" — if Codex proxy now mounts user MCPs, update user-codepilot-extensions.ts executableForKind("mcp_server", "codex_runtime") to return executable:true and remove this pin.`,
        );
      }
    }
  });

  it('user-codepilot-extensions classifies codex_runtime mcp_server as perception_only', async () => {
    // Runtime check — complements the source pin above. The scanner
    // already has its own test file; we duplicate the key assertion
    // here so a future contributor renaming `executableForKind`
    // sees the failure from BOTH directions.
    const { scanUserCodePilotExtensions } = await import(
      '@/lib/harness/user-codepilot-extensions'
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsMod = require('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const osMod = require('node:os');
    const tmp = fsMod.mkdtempSync(path.join(osMod.tmpdir(), 'codex-mcp-pin-'));
    try {
      fsMod.writeFileSync(
        path.join(tmp, '.mcp.json'),
        JSON.stringify({ mcpServers: { weather: { command: 'mcp-weather' } } }),
        'utf-8',
      );
      const out = scanUserCodePilotExtensions({
        workspacePath: tmp,
        runtimeId: 'codex_runtime',
      });
      const mcp = out.find((e) => e.kind === 'mcp_server');
      assert.ok(mcp);
      assert.equal(mcp!.executable, false);
    } finally {
      fsMod.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
