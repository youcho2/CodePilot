import fs from 'node:fs';
import path from 'node:path';

const MAX_VISITED_FILES = 20_000;
const MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export const SEARCH_EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '__pycache__',
]);

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

/** Compile the small glob surface exposed by the Native Glob/Grep tools. */
export function compileGlob(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  let source = normalized.includes('/') ? '^' : '^(?:.*/)?';

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        index += 1;
        if (normalized[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if (char === '[') {
      const closing = normalized.indexOf(']', index + 1);
      if (closing !== -1) {
        const body = normalized.slice(index + 1, closing);
        const negated = body.startsWith('!') ? `^${body.slice(1)}` : body;
        source += `[${negated.replace(/\\/g, '\\\\')}]`;
        index = closing;
        continue;
      }
    }
    if (char === '{') {
      const closing = normalized.indexOf('}', index + 1);
      if (closing !== -1) {
        const choices = normalized.slice(index + 1, closing).split(',');
        if (choices.length > 1) {
          source += `(?:${choices.map(escapeRegex).join('|')})`;
          index = closing;
          continue;
        }
      }
    }
    source += escapeRegex(char);
  }

  return new RegExp(`${source}$`);
}

function listFiles(root: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): string[] {
  const startedAt = Date.now();
  const pending = [root];
  const files: string[] = [];

  while (pending.length > 0 && files.length < MAX_VISITED_FILES) {
    if (Date.now() - startedAt > timeoutMs) break;
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SEARCH_EXCLUDED_DIRECTORIES.has(entry.name)) pending.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
        if (files.length >= MAX_VISITED_FILES) break;
      }
    }
  }

  return files;
}

function portableRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

export function globWithNode(cwd: string, pattern: string, limit: number = 200): string[] {
  const matcher = compileGlob(pattern);
  return listFiles(cwd)
    .map((filePath) => portableRelative(cwd, filePath))
    .filter((relativePath) => matcher.test(relativePath))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}

export interface NodeGrepOptions {
  pattern: string;
  root: string;
  target?: string;
  glob?: string;
  caseInsensitive?: boolean;
  contextLines?: number;
  limit?: number;
}

function isProbablyBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8_000)).includes(0);
}

/** Shell-free fallback for systems where the packaged PATH has no ripgrep. */
export function grepWithNode(options: NodeGrepOptions): string[] {
  const flags = options.caseInsensitive ? 'i' : '';
  const matcher = new RegExp(options.pattern, flags);
  const globMatcher = options.glob ? compileGlob(options.glob) : null;
  const contextLines = options.contextLines ?? 0;
  const limit = options.limit ?? 50;
  const target = options.target ?? options.root;
  let candidates: string[];

  try {
    const stat = fs.statSync(target);
    candidates = stat.isFile() ? [target] : stat.isDirectory() ? listFiles(target) : [];
  } catch {
    candidates = [];
  }

  const output: string[] = [];
  let matchCount = 0;
  for (const filePath of candidates) {
    const relativePath = portableRelative(options.root, filePath);
    if (globMatcher && !globMatcher.test(relativePath)) continue;

    let buffer: Buffer;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) continue;
      buffer = fs.readFileSync(filePath);
    } catch {
      continue;
    }
    if (isProbablyBinary(buffer)) continue;

    const lines = buffer.toString('utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      matcher.lastIndex = 0;
      if (!matcher.test(lines[index])) continue;

      const firstLine = Math.max(0, index - contextLines);
      const lastLine = Math.min(lines.length - 1, index + contextLines);
      for (let lineIndex = firstLine; lineIndex <= lastLine; lineIndex += 1) {
        const separator = lineIndex === index ? ':' : '-';
        output.push(`${relativePath}${separator}${lineIndex + 1}${separator}${lines[lineIndex]}`);
      }
      matchCount += 1;
      if (matchCount >= limit) return output;
    }
  }

  return output;
}
