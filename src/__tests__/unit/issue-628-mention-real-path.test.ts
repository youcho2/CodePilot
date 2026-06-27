/**
 * #628 — @-mention of an in-tree project file must let the AI Read/Edit the
 * USER'S REAL FILE, not a `.codepilot-uploads` copy. Root cause: mention files
 * were fetched as base64-only attachments (real path discarded) and route.ts
 * copied every non-directory file, so the AI edited a throwaway.
 *
 * Fix: FileAttachment.originPath (set on mentions at MessageInput) → route
 * resolves it inside cwd and references the real path instead of copying.
 *
 * Security is the crux: the client path is NEVER trusted — it's re-resolved
 * against workDir and containment-checked, so a crafted attachment can't hand
 * the AI a write path outside the project. These run against a real temp dir.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { resolveInTreeAttachmentPath } from '../../lib/in-tree-attachment';

describe('#628 — resolveInTreeAttachmentPath (cwd containment)', () => {
  let workDir: string;
  before(() => {
    workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'issue-628-')));
    fs.writeFileSync(path.join(workDir, 'real.ts'), 'export const x = 1;');
    fs.mkdirSync(path.join(workDir, 'sub'));
    fs.writeFileSync(path.join(workDir, 'sub', 'nested.md'), '# hi');
  });
  after(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('returns the real absolute path for an in-cwd file', () => {
    assert.equal(resolveInTreeAttachmentPath('real.ts', workDir), path.join(workDir, 'real.ts'));
  });
  it('resolves a nested in-cwd file', () => {
    assert.equal(resolveInTreeAttachmentPath('sub/nested.md', workDir), path.join(workDir, 'sub', 'nested.md'));
  });
  it('rejects a ../ escape (returns null → caller copies)', () => {
    assert.equal(resolveInTreeAttachmentPath('../outside.ts', workDir), null);
  });
  it('rejects an absolute path outside cwd', () => {
    assert.equal(resolveInTreeAttachmentPath('/etc/passwd', workDir), null);
  });
  it('rejects a non-existent in-cwd path', () => {
    assert.equal(resolveInTreeAttachmentPath('nope.ts', workDir), null);
  });
  it('rejects a directory (only regular files preserved)', () => {
    assert.equal(resolveInTreeAttachmentPath('sub', workDir), null);
  });
  it('rejects absent originPath / workDir', () => {
    assert.equal(resolveInTreeAttachmentPath(undefined, workDir), null);
    assert.equal(resolveInTreeAttachmentPath('', workDir), null);
    assert.equal(resolveInTreeAttachmentPath('real.ts', undefined), null);
  });
  it('rejects a prefix-sibling escape (`${workDir}-evil`, guarded by + path.sep)', () => {
    const sibling = workDir + '-evil';
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, 'x.ts'), 'x');
    try {
      assert.equal(
        resolveInTreeAttachmentPath('../' + path.basename(sibling) + '/x.ts', workDir),
        null,
      );
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });
});

describe('#628 — wiring source pins', () => {
  const types = readFileSync(path.resolve(__dirname, '../../types/index.ts'), 'utf8');
  const mi = readFileSync(path.resolve(__dirname, '../../components/chat/MessageInput.tsx'), 'utf8');
  const route = readFileSync(path.resolve(__dirname, '../../app/api/chat/route.ts'), 'utf8');

  it('FileAttachment declares originPath', () => {
    assert.match(types, /originPath\?: string;/);
  });
  it('mention attachments pass the real path (safePath) as originPath', () => {
    assert.match(mi, /fileResponseToAttachment\(res, filename, 'mention', safePath\)/);
  });
  it('route resolves the in-tree real path BEFORE writing a copy', () => {
    const real = route.indexOf('resolveInTreeAttachmentPath(f.originPath');
    const copy = route.indexOf('path.join(uploadDir,');
    assert.ok(real > 0 && real < copy, 'in-tree resolution must precede the copy write');
  });
});
