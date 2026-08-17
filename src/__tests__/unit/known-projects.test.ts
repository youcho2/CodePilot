/**
 * Unit tests for getKnownProjects (db).
 *
 * Semantic contract under test: a project folder is derived from DISTINCT
 * working_directory across ALL sessions, archived INCLUDED. So archiving every
 * conversation in a project keeps the folder (getKnownProjects still returns it),
 * while hard-deleting every conversation drops it. This is what keeps the sidebar
 * from losing a project when its last chat is archived (the reported bug).
 *
 * Uses CLAUDE_GUI_DATA_DIR to point at a temp dir for an isolated SQLite DB.
 * Same pattern as session-search.test.ts.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-known-projects-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createSession,
  updateSessionStatus,
  deleteSession,
  getKnownProjects,
  closeDb,
} = require('../../lib/db') as typeof import('../../lib/db');

const PROJ_ARCHIVED = '/tmp/proj-archived-only';
const PROJ_ACTIVE = '/tmp/proj-active';
const PROJ_HARD_DELETED = '/tmp/proj-hard-deleted';

describe('getKnownProjects (db)', () => {
  before(() => {
    // Project A: two sessions, BOTH archived → must still surface as a folder.
    const a1 = createSession('a1', 'sonnet', '', PROJ_ARCHIVED);
    const a2 = createSession('a2', 'sonnet', '', PROJ_ARCHIVED);
    updateSessionStatus(a1.id, 'archived');
    updateSessionStatus(a2.id, 'archived');

    // Project B: one active session → surfaces normally.
    createSession('b1', 'sonnet', '', PROJ_ACTIVE);

    // Project C: one session, then HARD deleted → folder must disappear.
    const c1 = createSession('c1', 'sonnet', '', PROJ_HARD_DELETED);
    deleteSession(c1.id);

    // A session with no working directory must NOT create a phantom project.
    createSession('no-project', 'sonnet', '', '');
  });

  after(() => {
    try {
      closeDb();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('keeps an archived-only project as a known folder (the bug fix)', () => {
    const dirs = getKnownProjects().map((p) => p.workingDirectory);
    assert.ok(
      dirs.includes(PROJ_ARCHIVED),
      'project whose conversations are all archived must still be returned',
    );
  });

  it('returns a project with active sessions', () => {
    const dirs = getKnownProjects().map((p) => p.workingDirectory);
    assert.ok(dirs.includes(PROJ_ACTIVE));
  });

  it('drops a project once all its sessions are hard-deleted', () => {
    const dirs = getKnownProjects().map((p) => p.workingDirectory);
    assert.ok(
      !dirs.includes(PROJ_HARD_DELETED),
      'hard-deleting every session removes the folder',
    );
  });

  it('excludes the empty (No Project) bucket', () => {
    const dirs = getKnownProjects().map((p) => p.workingDirectory);
    assert.ok(!dirs.includes(''));
  });

  it('reports each project once, with a latestUpdatedAt', () => {
    const archived = getKnownProjects().filter((p) => p.workingDirectory === PROJ_ARCHIVED);
    assert.equal(archived.length, 1, 'two archived sessions collapse to one folder');
    assert.ok(archived[0].latestUpdatedAt, 'latestUpdatedAt is populated');
  });
});
