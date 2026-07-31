import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/files/inspect/route';
import {
  inspectLocalPath,
  LocalPathInspectionError,
  openPathWithSystem,
} from '../../lib/local-path-navigation';

const testRoot = path.join(os.tmpdir(), `codepilot-path-inspect-${randomUUID()}`);
const workspace = path.join(testRoot, 'workspace');
const directory = path.join(workspace, 'docs');
const file = path.join(workspace, 'README.md');
const outside = path.join(testRoot, 'outside.txt');

fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(file, '# Hello');
fs.writeFileSync(outside, 'outside');

after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function request(target: string, baseDir = workspace): NextRequest {
  const params = new URLSearchParams({ path: target, baseDir });
  return new NextRequest(`http://localhost/api/files/inspect?${params}`);
}

describe('GET /api/files/inspect', () => {
  it('distinguishes files and directories without reading file contents', async () => {
    const fileResponse = await GET(request(file));
    assert.equal(fileResponse.status, 200);
    assert.deepEqual(await fileResponse.json(), { kind: 'file' });

    const directoryResponse = await GET(request(directory));
    assert.equal(directoryResponse.status, 200);
    assert.deepEqual(await directoryResponse.json(), { kind: 'directory' });
  });

  it('returns structured not-found and scope errors', async () => {
    const missing = await GET(request(path.join(workspace, 'missing')));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'not_found');

    const escaped = await GET(request(outside));
    assert.equal(escaped.status, 403);
    assert.equal((await escaped.json()).code, 'path_unsafe');
  });

  it('rejects a symlink that resolves outside the workspace', async () => {
    const link = path.join(workspace, 'escape-link');
    fs.symlinkSync(outside, link);
    const response = await GET(request(link));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'path_unsafe');
  });
});

describe('local path navigation client', () => {
  it('builds a scoped inspect request and returns the validated kind', async () => {
    let requestedUrl = '';
    const fetcher = (async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ kind: 'directory' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    assert.equal(await inspectLocalPath('/tmp/My Folder', '/tmp', fetcher), 'directory');
    const url = new URL(requestedUrl, 'http://localhost');
    assert.equal(url.pathname, '/api/files/inspect');
    assert.equal(url.searchParams.get('path'), '/tmp/My Folder');
    assert.equal(url.searchParams.get('baseDir'), '/tmp');
  });

  it('surfaces structured inspect failures', async () => {
    const fetcher = (async () => new Response(
      JSON.stringify({ error: 'Path is outside scope', code: 'path_unsafe' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

    await assert.rejects(
      () => inspectLocalPath('/etc', '/tmp', fetcher),
      (error: unknown) => {
        assert.ok(error instanceof LocalPathInspectionError);
        assert.equal(error.code, 'path_unsafe');
        assert.equal(error.status, 403);
        return true;
      },
    );
  });

  it('honors Electron openPath success and error semantics', async () => {
    let opened = '';
    await openPathWithSystem('/tmp/page.html', {
      openPath: async (target) => {
        opened = target;
        return '';
      },
    });
    assert.equal(opened, '/tmp/page.html');

    await assert.rejects(
      () => openPathWithSystem('/tmp/missing', { openPath: async () => 'No such file' }),
      /No such file/,
    );
  });
});
