import crypto from 'node:crypto';
import fs from 'node:fs';

export const MISSING_CONTENT_HASH = null;

export function hashBytes(value: string | Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

export function hashFile(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return hashBytes(fs.readFileSync(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
