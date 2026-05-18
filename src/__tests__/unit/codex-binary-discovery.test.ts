/**
 * Phase 5b smoke round 6 (2026-05-18) — `findCodexBinary` discovery
 * order pins.
 *
 * User-driven scenario: the macOS Codex.app installer drops the
 * `codex` binary inside the app bundle (`/Applications/Codex.app/
 * Contents/Resources/codex`) but doesn't always wire a PATH entry,
 * so users who installed via the .dmg saw "未安装" on Settings →
 * 执行引擎 → Codex even though `command -v codex` would resolve
 * via shell shims. The fix adds the bundled path as a last-resort
 * fallback AFTER PATH walk + CODEX_BIN + CODEX_DISABLED still take
 * priority.
 *
 * Behavioural test: drive the real function via env mutation to
 * cover the CODEX_DISABLED + CODEX_BIN paths. The macOS bundle
 * fallback can't be unit-tested without mocking `existsSync`, so
 * it's covered via a source-grep pin (the wider `app-server-manager
 * .ts` continues to be smoke-verified against a real CLI install).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findCodexBinary } from '@/lib/codex/app-server-manager';

const managerSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/app-server-manager.ts'),
  'utf8',
);

describe('findCodexBinary — discovery order (round 6)', () => {
  let savedDisabled: string | undefined;
  let savedBin: string | undefined;
  let savedPath: string | undefined;

  before(() => {
    savedDisabled = process.env.CODEX_DISABLED;
    savedBin = process.env.CODEX_BIN;
    savedPath = process.env.PATH;
  });

  after(() => {
    if (savedDisabled === undefined) delete process.env.CODEX_DISABLED;
    else process.env.CODEX_DISABLED = savedDisabled;
    if (savedBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = savedBin;
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  });

  it('CODEX_DISABLED=1 returns null even when CODEX_BIN points at a real file', () => {
    process.env.CODEX_DISABLED = '1';
    // Pick a path that definitely exists (this test file).
    process.env.CODEX_BIN = __filename;
    process.env.PATH = '';
    assert.equal(findCodexBinary(), null,
      'CODEX_DISABLED must beat CODEX_BIN — it is the test-harness escape hatch');
  });

  it('CODEX_BIN takes priority over PATH walk + macOS fallback', () => {
    delete process.env.CODEX_DISABLED;
    process.env.CODEX_BIN = __filename; // existing file
    process.env.PATH = '/no/such/dir';
    const out = findCodexBinary();
    assert.equal(out, __filename,
      'CODEX_BIN must return the explicit path when the file exists');
  });

  it('CODEX_BIN pointing at a non-existent file falls through to PATH walk', () => {
    delete process.env.CODEX_DISABLED;
    process.env.CODEX_BIN = '/definitely/does/not/exist/codex';
    process.env.PATH = '/no/such/dir';
    // No PATH match, no real CLI on the test machine for sure — but
    // on macOS we may find the Codex.app fallback. So we only assert
    // that the result isn't the broken CODEX_BIN path.
    const out = findCodexBinary();
    assert.notEqual(out, '/definitely/does/not/exist/codex',
      'CODEX_BIN with non-existent file must NOT be returned verbatim');
  });
});

describe('findCodexBinary — source pins (round 6 macOS bundle fallback)', () => {
  it('source declares the /Applications/Codex.app/Contents/Resources/codex fallback path', () => {
    // The exact path string. Refactoring is fine as long as the
    // literal stays present somewhere in the file — that's what
    // makes the .dmg-installed user no longer see "未安装".
    assert.match(
      managerSrc,
      /\/Applications\/Codex\.app\/Contents\/Resources\/codex/,
      'macOS Codex.app bundled-binary fallback path must remain in app-server-manager.ts',
    );
  });

  it('source gates the fallback on darwin (no Windows / Linux pickup of the macOS path)', () => {
    assert.match(
      managerSrc,
      /process\.platform\s*===\s*['"]darwin['"][\s\S]{0,400}Codex\.app/,
      'macOS fallback must be gated by process.platform === "darwin" so other platforms do not accidentally probe a macOS-specific path',
    );
  });

  it('source has the fallback AFTER the PATH walk (priority order)', () => {
    // Discovery priority: CODEX_DISABLED → CODEX_BIN → PATH → macOS
    // bundle. A future refactor that hoists the macOS path above
    // the PATH walk would silently mask a user's custom `codex`
    // build on their PATH, so we pin the order textually. Anchor on
    // the loop body of the PATH walk vs. the literal `/Applications
    // /Codex.app/...` string, since those are the load-bearing lines
    // that drive the runtime behaviour.
    const pathWalkIdx = managerSrc.search(/path\.split\(sep\)/);
    const macOsIdx = managerSrc.search(/\/Applications\/Codex\.app\/Contents\/Resources\/codex/);
    assert.notEqual(pathWalkIdx, -1, 'PATH walk anchor missing (looking for `path.split(sep)`)');
    assert.notEqual(macOsIdx, -1, 'macOS fallback path string missing');
    assert.ok(
      pathWalkIdx < macOsIdx,
      'PATH walk must come BEFORE the macOS Codex.app fallback so a custom `codex` on PATH still wins',
    );
  });
});
