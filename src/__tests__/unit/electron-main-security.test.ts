/**
 * Source-pin guardrails for two Loop-1 Electron security fixes (audit 2026-07).
 *
 * These invariants can't be exercised behaviorally in a node:test unit run
 * (Electron isn't loadable here), so — like `instrumentation-shape.test.ts`
 * and `sentry-dev-guard.test.ts` — we assert them against the source text,
 * stripping comments first so the explanatory comments (which necessarily
 * mention `outPath` / `http/https`) don't defeat the checks.
 *
 *  1.1  `artifact:export-long-shot` must never write to a renderer-supplied
 *       path. A compromised renderer could otherwise overwrite any file with
 *       PNG bytes. `outPath` is gone from the handler + preload; the handler
 *       only returns base64.
 *  1.7  The main window's `will-navigate` handler must whitelist http/https
 *       before `shell.openExternal`, mirroring `setWindowOpenHandler`, and
 *       guard URL parsing with try/catch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MAIN = path.resolve(__dirname, '../../../electron/main.ts');
const PRELOAD = path.resolve(__dirname, '../../../electron/preload.ts');

/** Strip line + block comments (same approach as sentry-dev-guard.test.ts). */
function stripComments(src: string): string {
  return src
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** From the first `{` at/after `fromIndex`, return the brace-balanced block. */
function balancedBlock(src: string, fromIndex: number): string {
  const open = src.indexOf('{', fromIndex);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

describe('electron main security guardrails (audit 2026-07 Loop 1)', () => {
  const main = stripComments(readFileSync(MAIN, 'utf-8'));
  const preload = stripComments(readFileSync(PRELOAD, 'utf-8'));

  it('1.1 — artifact export never accepts or writes a renderer-supplied outPath', () => {
    assert.doesNotMatch(
      main,
      /outPath/,
      'electron/main.ts must not reference outPath (removed for finding 1.1)',
    );
    assert.doesNotMatch(
      preload,
      /outPath/,
      'electron/preload.ts must not expose outPath on artifact.exportLongShot',
    );
    assert.doesNotMatch(
      main,
      /writeFile\(\s*outPath/,
      'the artifact handler must not fs.writeFile a renderer path',
    );
  });

  it('1.7 — mainWindow will-navigate delegates to classifyNavigation and only opens on the open-external decision', () => {
    const idx = main.indexOf("mainWindow.webContents.on('will-navigate'");
    assert.ok(idx >= 0, 'mainWindow will-navigate handler must exist');
    const body = balancedBlock(main, idx);

    // The http/https policy lives in the pure helper (behavior-tested in
    // navigation-policy.test.ts). The handler must route through it and must
    // NOT do an origin-only same-origin allow inline (that was the Codex
    // blocker: data: opaque origins bypassing the whitelist).
    assert.match(body, /classifyNavigation/, 'will-navigate must use the classifyNavigation policy helper');
    assert.match(body, /openExternal/, 'sanity: handler still opens external links');
    assert.match(
      body,
      /decision\s*===\s*['"]open-external['"]/,
      'openExternal must be gated on the open-external decision',
    );

    // The open-external gate must PRECEDE openExternal — it cannot be called
    // unconditionally on any path.
    const gateIdx = body.search(/decision\s*===\s*['"]open-external['"]/);
    const openIdx = body.indexOf('openExternal');
    assert.ok(
      gateIdx >= 0 && gateIdx < openIdx,
      'the open-external decision check must precede shell.openExternal',
    );
  });
});
