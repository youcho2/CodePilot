import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import {
  PROVIDER_SECRET_BACKEND_ENV,
  PROVIDER_SECRET_KEY_ENV,
  PROVIDER_SECRET_LEVEL_ENV,
} from '../src/lib/provider-secret-crypto';

interface WrappedProviderSecretKey {
  version: 1;
  wrappedKey: string;
  createdAt: string;
}

const ENCRYPTION_MODE_FILE = 'provider-encryption.json';
const PROVIDER_KEY_FILE = 'provider-secret-key.v1.json';

/**
 * Whether Provider secrets are stored OS-encrypted (safeStorage/keychain) or
 * plaintext. Read by the Electron main process at boot to decide whether to
 * touch the keychain at all.
 *
 * Default when no explicit choice exists yet:
 *   - a prior encrypting install (the wrapped-key file exists) → `true`, so we
 *     never strand already-encrypted keys (grandfather);
 *   - a fresh install → `false` (fork default: no keychain prompt, plaintext).
 */
export function readProviderEncryptionEnabled(userDataDir: string): boolean {
  const flagPath = path.join(userDataDir, ENCRYPTION_MODE_FILE);
  try {
    if (fs.existsSync(flagPath)) {
      const parsed = JSON.parse(fs.readFileSync(flagPath, 'utf8')) as { enabled?: unknown };
      return parsed.enabled === true;
    }
  } catch {
    // Unreadable/corrupt flag → fall through to the default heuristic.
  }
  return fs.existsSync(path.join(userDataDir, PROVIDER_KEY_FILE));
}

/** Persist the encryption mode choice (written by main via IPC from Settings). */
export function writeProviderEncryptionEnabled(userDataDir: string, enabled: boolean): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  const flagPath = path.join(userDataDir, ENCRYPTION_MODE_FILE);
  const tempPath = `${flagPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(tempPath, flagPath);
}

function storageBackend(): { backend: string; level: 'system_protected' | 'degraded' } {
  if (process.platform === 'win32') return { backend: 'windows_dpapi', level: 'system_protected' };
  if (process.platform === 'darwin') return { backend: 'macos_keychain', level: 'system_protected' };
  const backend = safeStorage.getSelectedStorageBackend();
  return {
    backend: `linux_${backend}`,
    level: backend === 'basic_text' || backend === 'unknown' ? 'degraded' : 'system_protected',
  };
}

/**
 * Load or create the data-encryption key. The on-disk file contains only the
 * safeStorage-wrapped key; the plaintext key is returned for the packaged
 * Next child environment and never logged or written beside the database.
 */
export function initializeProviderSecretEnvironment(userDataDir: string): Record<string, string> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safe_storage_unavailable');
  const keyPath = path.join(userDataDir, 'provider-secret-key.v1.json');
  let encodedKey: string;

  if (fs.existsSync(keyPath)) {
    const parsed = JSON.parse(fs.readFileSync(keyPath, 'utf8')) as WrappedProviderSecretKey;
    if (parsed.version !== 1 || typeof parsed.wrappedKey !== 'string' || !parsed.wrappedKey) {
      throw new Error('provider_secret_key_file_invalid');
    }
    encodedKey = safeStorage.decryptString(Buffer.from(parsed.wrappedKey, 'base64'));
  } else {
    encodedKey = crypto.randomBytes(32).toString('base64');
    const payload: WrappedProviderSecretKey = {
      version: 1,
      wrappedKey: safeStorage.encryptString(encodedKey).toString('base64'),
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(userDataDir, { recursive: true });
    const tempPath = `${keyPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, keyPath);
  }

  if (Buffer.from(encodedKey, 'base64').length !== 32) {
    throw new Error('provider_secret_key_invalid');
  }
  const storage = storageBackend();
  return {
    [PROVIDER_SECRET_KEY_ENV]: encodedKey,
    [PROVIDER_SECRET_BACKEND_ENV]: storage.backend,
    [PROVIDER_SECRET_LEVEL_ENV]: storage.level,
  };
}
