/**
 * Phase 2 (2026-06-03) — new-chat ownership foundation.
 *
 * Today a session only stores `working_directory` + `source` (user|task); it
 * can't say whether it was created from the assistant / a workspace / a folder
 * / a file. This adds `chat_origin_type` + `chat_origin_path`. These tests pin
 * that the origin persists + round-trips, and that legacy call sites (no origin
 * passed) stay compatible (empty origin, never a crash).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempDataDir: string;
let tempHome: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-chatorigin-db-'));
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-chatorigin-home-'));
  process.env.CLAUDE_GUI_DATA_DIR = tempDataDir;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalDataDir !== undefined) process.env.CLAUDE_GUI_DATA_DIR = originalDataDir; else delete process.env.CLAUDE_GUI_DATA_DIR;
  if (originalHome !== undefined) process.env.HOME = originalHome; else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile; else delete process.env.USERPROFILE;
  try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('chat creation origin — persistence + round-trip (Phase 2)', () => {
  it('persists each origin type + path and reads them back', async () => {
    const { createSession, getSession } = await import('../../lib/db');
    for (const t of ['assistant', 'workspace', 'folder', 'file'] as const) {
      const originPath = `${tempHome}/origin-${t}`;
      const s = createSession('t', 'sonnet', '', tempHome, 'code', '', 'default', undefined, t, originPath);
      const got = getSession(s.id);
      assert.ok(got, 'session must be readable back');
      assert.equal(got!.chat_origin_type, t, `origin type ${t} must round-trip`);
      assert.equal(got!.chat_origin_path, originPath, 'origin path must round-trip');
    }
  });

  it('legacy createSession (no origin args) stores empty origin — backward compatible', async () => {
    const { createSession, getSession } = await import('../../lib/db');
    const s = createSession('t', 'sonnet', '', tempHome, 'code');
    const got = getSession(s.id);
    assert.ok(got);
    assert.equal(got!.chat_origin_type, '', 'legacy sessions have no origin type');
    assert.equal(got!.chat_origin_path, '', 'legacy sessions have no origin path');
  });

  it('origin is independent of source (task tagging) and working_directory', async () => {
    const { createSession, getSession } = await import('../../lib/db');
    // A folder-origin chat is still a normal user chat (source defaults user).
    const s = createSession('t', 'sonnet', '', tempHome, 'code', '', 'default', 'user', 'folder', `${tempHome}/sub`);
    const got = getSession(s.id)!;
    assert.equal(got.source, 'user');
    assert.equal(got.chat_origin_type, 'folder');
    assert.equal(got.working_directory, tempHome, 'working_directory stays the session dir, origin path is separate');
  });
});

describe('POST /api/chat/sessions — threads origin to createSession (Phase 2)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/chat/sessions/route.ts'),
    'utf8',
  );
  it('passes chat_origin_type + chat_origin_path through to createSession', () => {
    assert.match(src, /body\.chat_origin_type/);
    assert.match(src, /body\.chat_origin_path/);
  });
});
