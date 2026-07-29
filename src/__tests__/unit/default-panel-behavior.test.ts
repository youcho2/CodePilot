import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_PANEL,
  DEFAULT_PANEL_MIGRATION_KEY,
  shouldResetLegacyDefaultPanel,
} from '../../lib/default-panel';

describe('new conversation default panel', () => {
  it('defaults to no auto-opened panel', () => {
    assert.equal(DEFAULT_PANEL, 'none');
    assert.match(DEFAULT_PANEL_MIGRATION_KEY, /default_panel_none/);
  });

  it('resets the legacy seeded file tree only before the migration marker exists', () => {
    assert.equal(shouldResetLegacyDefaultPanel('file_tree', undefined), true);
    assert.equal(shouldResetLegacyDefaultPanel(undefined, undefined), true);
    assert.equal(shouldResetLegacyDefaultPanel('file_tree', '1'), false);
  });

  it('preserves explicit non-default choices and all post-migration choices', () => {
    assert.equal(shouldResetLegacyDefaultPanel('git', undefined), false);
    assert.equal(shouldResetLegacyDefaultPanel('dashboard', undefined), false);
    assert.equal(shouldResetLegacyDefaultPanel('none', undefined), false);
    assert.equal(shouldResetLegacyDefaultPanel('git', '1'), false);
  });

  it('applies the legacy reset atomically and remains idempotent after restart', () => {
    const previousDataDir = process.env.CLAUDE_GUI_DATA_DIR;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-panel-migration-'));
    const dbPath = path.join(dataDir, 'codepilot.db');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL
      );
    `);
    raw.prepare(
      "INSERT INTO settings (key, value) VALUES ('default_panel', 'file_tree')"
    ).run();
    raw.close();

    const modulePath = require.resolve('../../lib/db');
    let appDb: typeof import('../../lib/db') | undefined;
    try {
      process.env.CLAUDE_GUI_DATA_DIR = dataDir;
      delete require.cache[modulePath];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      appDb = require('../../lib/db') as typeof import('../../lib/db');

      assert.equal(appDb.getSetting('default_panel'), DEFAULT_PANEL);
      assert.equal(appDb.getSetting(DEFAULT_PANEL_MIGRATION_KEY), '1');

      // A later explicit File Tree choice survives the next startup because
      // the migration marker makes the preference migration one-shot.
      appDb.setSetting('default_panel', 'file_tree');
      appDb.closeDb();
      delete require.cache[modulePath];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      appDb = require('../../lib/db') as typeof import('../../lib/db');
      assert.equal(appDb.getSetting('default_panel'), 'file_tree');
    } finally {
      appDb?.closeDb();
      delete require.cache[modulePath];
      if (previousDataDir === undefined) delete process.env.CLAUDE_GUI_DATA_DIR;
      else process.env.CLAUDE_GUI_DATA_DIR = previousDataDir;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
