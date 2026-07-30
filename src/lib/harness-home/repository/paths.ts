import fs from 'node:fs';
import path from 'node:path';

export const HARNESS_MANIFEST_FILE = 'manifest.json';
export const HARNESS_INTERNAL_DIR = '.harness-home';
export const HARNESS_LOCK_FILE = 'writer.lock.json';
export const HARNESS_TRANSACTIONS_DIR = 'transactions';

export function assertSafeRepositoryPath(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Repository path must be relative: ${relativePath}`);
  }
  const normalized = path.normalize(relativePath);
  const parts = normalized.split(path.sep);
  if (
    normalized === '..'
    || normalized.startsWith(`..${path.sep}`)
    || parts.includes('..')
    || normalized === HARNESS_INTERNAL_DIR
    || normalized.startsWith(`${HARNESS_INTERNAL_DIR}${path.sep}`)
  ) {
    throw new Error(`Repository path escapes or targets internal state: ${relativePath}`);
  }
}

export function resolveRepositoryPath(root: string, relativePath: string): string {
  assertSafeRepositoryPath(relativePath);
  const resolved = path.resolve(root, relativePath);
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  if (resolved !== path.resolve(root) && !resolved.startsWith(rootPrefix)) {
    throw new Error(`Repository path escapes root: ${relativePath}`);
  }
  return resolved;
}

/**
 * Reject an existing symlink anywhere between root and the target.
 * Canonical writes never follow a user-controlled link outside the root.
 */
export function assertNoSymlinkTraversal(root: string, relativePath: string): void {
  assertSafeRepositoryPath(relativePath);
  const parts = path.normalize(relativePath).split(path.sep);
  let cursor = path.resolve(root);
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`Repository path traverses a symlink: ${relativePath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

export function resolveInternalPath(root: string, ...parts: string[]): string {
  return path.join(root, HARNESS_INTERNAL_DIR, ...parts);
}
