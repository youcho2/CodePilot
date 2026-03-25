import { getDb } from '@/lib/db';
import type { MediaBlock } from '@/types';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
const MEDIA_DIR = path.join(dataDir, '.codepilot-media');

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
};

const EXT_TO_MIME: Record<string, string> = {};
for (const [mime, ext] of Object.entries(MIME_TO_EXT)) {
  EXT_TO_MIME[ext] = mime;
}

interface SaveMediaOptions {
  sessionId?: string;
  source?: string;   // e.g. 'mcp', 'jimeng-cli'
  prompt?: string;    // description / title
  tags?: string[];
}

interface SaveMediaResult {
  localPath: string;
  mediaId: string;
}

function ensureMediaDir() {
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  }
}

function mimeToMediaType(mimeType: string): 'image' | 'video' | 'audio' {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'image';
}

function insertDbRecord(opts: {
  id: string;
  type: string;
  provider: string;
  prompt: string;
  localPath: string;
  sessionId?: string;
  tags: string[];
  metadata: Record<string, unknown>;
}) {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(
    `INSERT INTO media_generations (id, type, status, provider, model, prompt, aspect_ratio, image_size, local_path, thumbnail_path, session_id, message_id, tags, metadata, error, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.id, opts.type, 'completed', opts.provider, '',
    opts.prompt, '', '', opts.localPath, '',
    opts.sessionId || null, null,
    JSON.stringify(opts.tags), JSON.stringify(opts.metadata),
    null, now, now
  );
}

/**
 * Save a base64-encoded media block (from MCP tool result) to the library.
 * Writes file to ~/.codepilot/.codepilot-media/ and creates a DB record.
 */
export function saveMediaToLibrary(block: MediaBlock, opts: SaveMediaOptions = {}): SaveMediaResult {
  ensureMediaDir();

  const ext = MIME_TO_EXT[block.mimeType] || '.bin';
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const localPath = path.join(MEDIA_DIR, filename);

  const buffer = Buffer.from(block.data!, 'base64');
  fs.writeFileSync(localPath, buffer);

  const id = crypto.randomBytes(16).toString('hex');
  insertDbRecord({
    id,
    type: mimeToMediaType(block.mimeType),
    provider: opts.source || 'mcp',
    prompt: opts.prompt || '',
    localPath,
    sessionId: opts.sessionId,
    tags: opts.tags || [],
    metadata: { mimeType: block.mimeType, source: opts.source || 'mcp' },
  });

  return { localPath, mediaId: id };
}

/**
 * Import an existing local file to the library (for CLI tool output).
 * Copies file to ~/.codepilot/.codepilot-media/ and creates a DB record.
 */
export function importFileToLibrary(
  filePath: string,
  opts: SaveMediaOptions & { mimeType?: string } = {}
): SaveMediaResult {
  ensureMediaDir();

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeType = opts.mimeType || EXT_TO_MIME[ext] || 'application/octet-stream';
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const destPath = path.join(MEDIA_DIR, filename);

  fs.copyFileSync(resolved, destPath);

  const id = crypto.randomBytes(16).toString('hex');
  insertDbRecord({
    id,
    type: mimeToMediaType(mimeType),
    provider: opts.source || 'cli-import',
    prompt: opts.prompt || path.basename(filePath),
    localPath: destPath,
    sessionId: opts.sessionId,
    tags: opts.tags || [],
    metadata: { mimeType, source: opts.source || 'cli-import', originalPath: filePath },
  });

  return { localPath: destPath, mediaId: id };
}
