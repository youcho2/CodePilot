import '../db-isolation.setup';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createProvider,
  deleteProvider,
  getDb,
  getProvider,
  getProviderSecretStorageDiagnostics,
  migrateProviderSecrets,
  updateProvider,
} from '../../lib/db';

describe('provider secret storage', () => {
  it('stores new keys as ciphertext and materializes plaintext only in memory', () => {
    const plaintext = 'sk-测试-value';
    const provider = createProvider({
      name: `secret-test-${Date.now()}`,
      provider_type: 'custom',
      base_url: 'https://example.invalid',
      api_key: plaintext,
    });

    try {
      const raw = getDb().prepare(
        'SELECT api_key, api_key_ciphertext, api_key_storage FROM api_providers WHERE id = ?',
      ).get(provider.id) as { api_key: string; api_key_ciphertext: string; api_key_storage: string };
      assert.equal(raw.api_key, '');
      assert.match(raw.api_key_ciphertext, /^cpsec:v1:/);
      assert.doesNotMatch(raw.api_key_ciphertext, /测试|value/);
      assert.equal(raw.api_key_storage, 'safe_storage:test');
      const materialized = getProvider(provider.id);
      assert.equal(materialized?.api_key, plaintext);
      assert.equal('api_key_ciphertext' in (materialized ?? {}), false);

      const priorCiphertext = raw.api_key_ciphertext;
      updateProvider(provider.id, { notes: 'metadata-only update' });
      const after = getDb().prepare(
        'SELECT api_key_ciphertext FROM api_providers WHERE id = ?',
      ).get(provider.id) as { api_key_ciphertext: string };
      assert.equal(after.api_key_ciphertext, priorCiphertext);
    } finally {
      deleteProvider(provider.id);
    }
  });

  it('migrates legacy plaintext transactionally and idempotently', () => {
    const id = `legacy-secret-${Date.now()}`;
    const plaintext = 'legacy-secret-value';
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO api_providers
        (id, name, provider_type, base_url, api_key, api_key_ciphertext, api_key_storage, created_at, updated_at)
      VALUES (?, ?, 'custom', 'https://example.invalid', ?, '', 'legacy_plaintext', ?, ?)
    `).run(id, id, plaintext, now, now);

    try {
      assert.equal(migrateProviderSecrets(getDb()), 1);
      assert.equal(migrateProviderSecrets(getDb()), 0);
      const raw = getDb().prepare(
        'SELECT api_key, api_key_ciphertext, api_key_storage FROM api_providers WHERE id = ?',
      ).get(id) as { api_key: string; api_key_ciphertext: string; api_key_storage: string };
      assert.equal(raw.api_key, '');
      assert.match(raw.api_key_ciphertext, /^cpsec:v1:/);
      assert.equal(raw.api_key_storage, 'safe_storage:test');
      assert.equal(getProvider(id)?.api_key, plaintext);

      const diagnostics = getProviderSecretStorageDiagnostics();
      assert.equal(diagnostics.available, true);
      assert.equal(diagnostics.backend, 'test');
      assert.ok(diagnostics.encryptedProviders >= 1);
      assert.equal(diagnostics.legacyPlaintextProviders, 0);
      assert.equal(diagnostics.lastErrorCode, null);
      assert.doesNotMatch(JSON.stringify(diagnostics), /legacy-secret-value|cpsec:v1/);
    } finally {
      deleteProvider(id);
    }
  });
});
