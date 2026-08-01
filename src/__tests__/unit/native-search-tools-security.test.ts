import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGlobTool } from '@/lib/tools/glob';
import { createGrepTool } from '@/lib/tools/grep';

type ExecutableTool = {
  execute?: (input: unknown, options: unknown) => Promise<unknown> | unknown;
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-search-tools-'));

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function executeTool(tool: ExecutableTool, input: unknown): Promise<unknown> {
  assert.equal(typeof tool.execute, 'function');
  return Promise.resolve(tool.execute!(input, {
    toolCallId: 'security-test',
    messages: [],
  }));
}

function injectionPayload(marker: string): string {
  return process.platform === 'win32'
    ? `x & type nul > "${marker}" & rem`
    : `; touch "${marker}" #`;
}

describe('Native Grep/Glob command boundary', () => {
  it('Grep treats shell metacharacters as one rg/grep argument', async () => {
    const marker = path.join(root, 'grep-injected');
    const tool = createGrepTool({ workingDirectory: root }) as ExecutableTool;
    await executeTool(tool, {
      pattern: injectionPayload(marker),
      max_results: 5,
    });
    assert.equal(fs.existsSync(marker), false);
  });

  it('Glob treats shell metacharacters as one glob argument', async () => {
    const marker = path.join(root, 'glob-injected');
    const tool = createGlobTool({ workingDirectory: root }) as ExecutableTool;
    await executeTool(tool, { pattern: injectionPayload(marker) });
    assert.equal(fs.existsSync(marker), false);
  });

  it('keeps ordinary Grep and recursive Glob behavior', async () => {
    const sourceDir = path.join(root, 'src');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'sample.ts'), 'const needle = true;\n');
    fs.writeFileSync(path.join(sourceDir, 'sample.js'), 'const other = true;\n');

    const grep = createGrepTool({ workingDirectory: root }) as ExecutableTool;
    const grepResult = String(await executeTool(grep, { pattern: 'needle' }));
    assert.match(grepResult, /src\/sample\.ts:1:const needle = true/);

    const glob = createGlobTool({ workingDirectory: root }) as ExecutableTool;
    const globResult = String(await executeTool(glob, { pattern: '**/*.ts' }));
    assert.match(globResult, /src\/sample\.ts/);
    assert.doesNotMatch(globResult, /sample\.js/);

    const emptyGlobResult = String(await executeTool(glob, { pattern: '**/*.rs' }));
    assert.match(emptyGlobResult, /No files found matching pattern/);
  });
});
