/**
 * Unit tests for assistant workspace.
 *
 * Run with: npx tsx --test src/__tests__/unit/assistant-workspace.test.ts
 *
 * Tests verify:
 * 1. Auto-trigger: onboarding detects correctly for new workspace
 * 2. Input focus fallback: hookTriggeredSessionId prevents repeat
 * 3. Daily check-in: needsDailyCheckIn respects onboarding state
 * 4. Workspace prompt scoping: only assistant project sessions get prompts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Set a temp data dir before importing db module
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-workspace-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  initializeWorkspace,
  loadState,
  saveState,
  needsDailyCheckIn,
  loadWorkspaceFiles,
  assembleWorkspacePrompt,
  generateDirectoryDocs,
} = require('../../lib/assistant-workspace') as typeof import('../../lib/assistant-workspace');

const { createSession, getLatestSessionByWorkingDirectory, closeDb } = require('../../lib/db') as typeof import('../../lib/db');

describe('Assistant Workspace', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-ws-'));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  describe('initializeWorkspace creates state.json', () => {
    it('should create .assistant/state.json on init', () => {
      initializeWorkspace(workDir);
      const statePath = path.join(workDir, '.assistant', 'state.json');
      assert.ok(fs.existsSync(statePath), 'state.json should exist after init');

      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      assert.equal(state.onboardingComplete, false);
      assert.equal(state.lastCheckInDate, null);
      assert.equal(state.schemaVersion, 1);
    });

    it('should create all 4 template files', () => {
      initializeWorkspace(workDir);
      assert.ok(fs.existsSync(path.join(workDir, 'claude.md')));
      assert.ok(fs.existsSync(path.join(workDir, 'soul.md')));
      assert.ok(fs.existsSync(path.join(workDir, 'user.md')));
      assert.ok(fs.existsSync(path.join(workDir, 'memory.md')));
    });
  });

  describe('onboarding auto-trigger detection', () => {
    it('should detect onboarding needed for fresh workspace', () => {
      initializeWorkspace(workDir);
      const state = loadState(workDir);
      assert.equal(state.onboardingComplete, false);
      // needsDailyCheckIn should return false when onboarding not done
      assert.equal(needsDailyCheckIn(state), false);
    });

    it('should not need onboarding after completion', () => {
      initializeWorkspace(workDir);
      const state = loadState(workDir);
      state.onboardingComplete = true;
      state.lastCheckInDate = new Date().toISOString().slice(0, 10);
      saveState(workDir, state);

      const reloaded = loadState(workDir);
      assert.equal(reloaded.onboardingComplete, true);
    });
  });

  describe('hookTriggeredSessionId prevents repeat', () => {
    it('should persist hookTriggeredSessionId', () => {
      initializeWorkspace(workDir);
      const state = loadState(workDir);
      state.hookTriggeredSessionId = 'session-123';
      saveState(workDir, state);

      const reloaded = loadState(workDir);
      assert.equal(reloaded.hookTriggeredSessionId, 'session-123');
    });

    it('should allow different session to trigger', () => {
      initializeWorkspace(workDir);
      const state = loadState(workDir);
      state.hookTriggeredSessionId = 'session-123';
      saveState(workDir, state);

      const reloaded = loadState(workDir);
      // A different session ID should not match
      assert.notEqual(reloaded.hookTriggeredSessionId, 'session-456');
    });
  });

  describe('daily check-in respects onboarding state', () => {
    it('should not trigger check-in if onboarding not complete', () => {
      const state = { onboardingComplete: false, lastCheckInDate: null, schemaVersion: 1 };
      assert.equal(needsDailyCheckIn(state), false);
    });

    it('should trigger check-in if onboarding done and no check-in today', () => {
      const state = { onboardingComplete: true, lastCheckInDate: '2020-01-01', schemaVersion: 1 };
      assert.equal(needsDailyCheckIn(state), true);
    });

    it('should not trigger check-in if already done today', () => {
      const today = new Date().toISOString().slice(0, 10);
      const state = { onboardingComplete: true, lastCheckInDate: today, schemaVersion: 1 };
      assert.equal(needsDailyCheckIn(state), false);
    });

    it('onboarding day should skip daily check-in (lastCheckInDate set)', () => {
      // Simulates what happens after onboarding completes:
      // onboardingComplete=true, lastCheckInDate=today
      const today = new Date().toISOString().slice(0, 10);
      const state = { onboardingComplete: true, lastCheckInDate: today, schemaVersion: 1 };
      assert.equal(needsDailyCheckIn(state), false);
    });
  });

  describe('workspace prompt scoping', () => {
    it('should generate prompt for workspace files', () => {
      initializeWorkspace(workDir);
      // Write some content
      fs.writeFileSync(path.join(workDir, 'soul.md'), '# Soul\nI am helpful.', 'utf-8');

      const files = loadWorkspaceFiles(workDir);
      const prompt = assembleWorkspacePrompt(files);

      assert.ok(prompt.includes('<assistant-workspace>'));
      assert.ok(prompt.includes('I am helpful'));
    });

    it('should return empty prompt for empty workspace', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-ws-'));
      const files = loadWorkspaceFiles(emptyDir);
      const prompt = assembleWorkspacePrompt(files);
      assert.equal(prompt, '');
      fs.rmSync(emptyDir, { recursive: true, force: true });
    });
  });

  describe('session reuse for daily check-in', () => {
    it('should find latest session by working directory', () => {
      // Create a session for the directory
      const s1 = createSession('First', '', undefined, workDir);

      const latest = getLatestSessionByWorkingDirectory(workDir);
      assert.ok(latest, 'Should find a session');
      assert.equal(latest!.id, s1.id, 'Should return the session for this directory');
      assert.equal(latest!.working_directory, workDir);
    });

    it('should return undefined for directory with no sessions', () => {
      const result = getLatestSessionByWorkingDirectory('/nonexistent/dir');
      assert.equal(result, undefined);
    });
  });

  describe('generateDirectoryDocs produces README.ai.md and PATH.ai.md', () => {
    it('should generate both files for subdirectories', () => {
      // Create a subdirectory with some files
      const subDir = path.join(workDir, 'notes');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'todo.txt'), 'buy milk', 'utf-8');
      fs.writeFileSync(path.join(subDir, 'ideas.md'), '# Ideas', 'utf-8');

      const generated = generateDirectoryDocs(workDir);

      assert.ok(generated.length >= 2, 'Should generate at least 2 files');

      const readmePath = path.join(subDir, 'README.ai.md');
      const pathFilePath = path.join(subDir, 'PATH.ai.md');

      assert.ok(fs.existsSync(readmePath), 'README.ai.md should exist');
      assert.ok(fs.existsSync(pathFilePath), 'PATH.ai.md should exist');

      const readmeContent = fs.readFileSync(readmePath, 'utf-8');
      assert.ok(readmeContent.includes('<!-- AI_GENERATED_START -->'));
      assert.ok(readmeContent.includes('ideas.md'));

      const pathContent = fs.readFileSync(pathFilePath, 'utf-8');
      assert.ok(pathContent.includes('<!-- AI_GENERATED_START -->'));
      assert.ok(pathContent.includes('Path Index'));
    });
  });
});

// Clean up DB
describe('cleanup', () => {
  it('close db', () => {
    closeDb();
  });
});
