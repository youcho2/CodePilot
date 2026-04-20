import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import type { FileTreeNode, FilePreview } from '@/types';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.cache',
  '.turbo',
  'coverage',
  '.output',
  'build',
]);

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
  prisma: 'prisma',
  env: 'dotenv',
  lua: 'lua',
  r: 'r',
  php: 'php',
  dart: 'dart',
  zig: 'zig',
};

export function getFileLanguage(ext: string): string {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  return LANGUAGE_MAP[normalized] || 'plaintext';
}

export function isPathSafe(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
}

/**
 * Check if a path is a filesystem root (e.g., `/`, `C:\`, `D:\`).
 * Used to prevent using root as a baseDir for file browsing.
 */
export function isRootPath(p: string): boolean {
  const resolved = path.resolve(p);
  return resolved === path.parse(resolved).root;
}

export async function scanDirectory(dir: string, depth: number = 3): Promise<FileTreeNode[]> {
  const resolvedDir = path.resolve(dir);

  // turbopackIgnore hints: every fs.* / createReadStream here takes a runtime
  // user-supplied path, so Turbopack's NFT can't statically resolve what's
  // touched. Without these, Turbopack conservatively pulls the whole project
  // into the route's NFT list (and surfaces it as "next.config.ts was
  // unexpectedly traced" warnings on `npm run build`).
  try {
    await fs.access(/*turbopackIgnore: true*/ resolvedDir);
  } catch {
    return [];
  }

  return scanDirectoryRecursive(resolvedDir, depth);
}

async function scanDirectoryRecursive(dir: string, depth: number): Promise<FileTreeNode[]> {
  if (depth <= 0) return [];

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(/*turbopackIgnore: true*/ dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];

  // Sort: directories first, then files, both alphabetically
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    // Skip hidden files/dirs (except common config files)
    if (entry.name.startsWith('.') && !entry.name.startsWith('.env')) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      const children = await scanDirectoryRecursive(fullPath, depth - 1);
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).replace(/^\./, '');
      let size: number | undefined;
      try {
        const stat = await fs.stat(/*turbopackIgnore: true*/ fullPath);
        size = stat.size;
      } catch {
        // Skip files we can't stat
      }

      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
        size,
        extension: ext || undefined,
      });
    }
  }

  return nodes;
}

/**
 * Per-extension line caps for preview API.
 *
 * Prose files (Markdown, plain text, logs, delimited data) get a generous cap
 * so long AI-generated reports and 10万-字符级 Markdown display completely.
 * Code files keep a tighter cap because full file rendering is rarely useful
 * in a side panel.
 *
 * Unknown extensions fall through to DEFAULT_LINE_CAP.
 */
const EXTENSION_LINE_CAPS: Record<string, number> = {
  md: 50000,
  mdx: 50000,
  txt: 50000,
  log: 10000,
  csv: 10000,
  tsv: 10000,
};

const DEFAULT_LINE_CAP = 1000;

/** Hard ceiling — no preview can exceed this even if extension allows more. */
const ABSOLUTE_LINE_CEILING = 100000;

/** Single-file byte ceiling. Files larger than this return file_too_large. */
const BYTE_CEILING = 10 * 1024 * 1024;  // 10 MB

/** Number of bytes read for binary detection before committing to preview. */
const BINARY_DETECTION_SAMPLE = 4096;

/** Extension-free filenames (e.g. LICENSE, README) get default cap. */
function getLineCap(ext: string, userMax?: number): number {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  const extensionCap = EXTENSION_LINE_CAPS[normalized] ?? DEFAULT_LINE_CAP;
  const withUserMax = userMax ? Math.min(userMax, extensionCap) : extensionCap;
  return Math.min(withUserMax, ABSOLUTE_LINE_CEILING);
}

/**
 * Detect if a byte buffer is likely binary content.
 * Uses the classic heuristic: any NUL byte or >30% non-printable/non-whitespace
 * means the file is not safe to render as UTF-8 text.
 */
function looksBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let nonText = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0) return true;  // NUL byte → definitely binary
    // Printable ASCII + common whitespace (tab, LF, CR, FF)
    if (b === 9 || b === 10 || b === 12 || b === 13 || (b >= 32 && b <= 126)) continue;
    // High bytes could be multi-byte UTF-8; count them as "possibly non-text"
    if (b >= 128) continue;  // Treat as potential UTF-8 continuation
    nonText++;
  }
  return nonText / buf.length > 0.3;
}

/**
 * Structured errors thrown by readFilePreview. The API route maps these to
 * HTTP status codes + error codes so callers can branch on the kind.
 */
export class FilePreviewError extends Error {
  constructor(public code: 'not_found' | 'not_a_file' | 'file_too_large' | 'binary_not_previewable' | 'read_failed', message: string, public meta?: Record<string, unknown>) {
    super(message);
    this.name = 'FilePreviewError';
  }
}

export async function readFilePreview(filePath: string, userMaxLines?: number): Promise<FilePreview> {
  const resolvedPath = path.resolve(filePath);

  // Same turbopackIgnore rationale as scanDirectory — runtime-dynamic path.
  try {
    await fs.access(/*turbopackIgnore: true*/ resolvedPath);
  } catch {
    throw new FilePreviewError('not_found', `File not found: ${filePath}`);
  }

  const stat = await fs.stat(/*turbopackIgnore: true*/ resolvedPath);
  if (!stat.isFile()) {
    throw new FilePreviewError('not_a_file', `Not a file: ${filePath}`);
  }

  const bytesTotal = stat.size;

  // Guard 1: hard byte ceiling. Refuse before opening the stream to avoid
  // wasting memory on files beyond what any UI can usefully display.
  if (bytesTotal > BYTE_CEILING) {
    throw new FilePreviewError(
      'file_too_large',
      `File too large to preview: ${bytesTotal} bytes (limit ${BYTE_CEILING})`,
      { bytes_total: bytesTotal, byte_limit: BYTE_CEILING },
    );
  }

  // Guard 2: binary detection on the first 4KB. Must run before we commit to
  // UTF-8 stream decoding; otherwise binary files produce garbage + may throw
  // deep inside createInterface.
  try {
    const fd = await fs.open(/*turbopackIgnore: true*/ resolvedPath, 'r');
    try {
      const sampleSize = Math.min(BINARY_DETECTION_SAMPLE, bytesTotal);
      const sample = Buffer.alloc(sampleSize);
      await fd.read(sample, 0, sampleSize, 0);
      if (looksBinary(sample)) {
        throw new FilePreviewError(
          'binary_not_previewable',
          `Binary file cannot be previewed: ${filePath}`,
          { bytes_total: bytesTotal },
        );
      }
    } finally {
      await fd.close();
    }
  } catch (err) {
    if (err instanceof FilePreviewError) throw err;
    throw new FilePreviewError('read_failed', `Failed to sample file: ${String(err)}`);
  }

  const ext = path.extname(resolvedPath).replace(/^\./, '');
  const language = getFileLanguage(ext);
  const maxLines = getLineCap(ext, userMaxLines);

  // Stream-read only up to maxLines to avoid loading entire large files.
  const collectedLines: string[] = [];
  let scannedLineCount = 0;
  let hitLimit = false;
  let bytesRead = 0;

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(/*turbopackIgnore: true*/ resolvedPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      scannedLineCount++;
      if (collectedLines.length < maxLines) {
        collectedLines.push(line);
        bytesRead += Buffer.byteLength(line, 'utf-8') + 1;  // +1 for newline
      } else {
        hitLimit = true;
        rl.close();
        stream.destroy();
      }
    });

    rl.on('close', () => resolve());
    rl.on('error', reject);
    stream.on('error', reject);
  });

  // If we read the entire file, scannedLineCount is exact.
  // If we hit the limit early, estimate total from size (heuristic: ~60 bytes/line).
  const estimatedTotalLines = Math.max(1, Math.ceil(bytesTotal / 60));
  const lineCount = hitLimit
    ? Math.max(scannedLineCount, estimatedTotalLines)
    : scannedLineCount;

  const content = collectedLines.join('\n');

  return {
    path: resolvedPath,
    content,
    language,
    line_count: lineCount,
    line_count_exact: !hitLimit,
    truncated: hitLimit,
    bytes_read: Buffer.byteLength(content, 'utf-8'),
    bytes_total: bytesTotal,
  };
}
