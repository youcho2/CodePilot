import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.json', '.txt',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
]);
const MAX_FILES = 512;
const MAX_SCANNED_ENTRIES = 4_096;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export interface HtmlBundleInspection {
  readonly root: string;
  readonly entryFile: string;
  readonly files: readonly string[];
  readonly byteSize: number;
  readonly contentHash: string;
  readonly externalUrls: readonly string[];
}

function isHiddenRelativePath(relativePath: string): boolean {
  return relativePath.split(path.sep).some((segment) => segment.startsWith('.'));
}

function assertSafeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('/../')
  ) {
    throw new Error(`HTML bundle path "${relativePath}" escapes its source root.`);
  }
  return normalized;
}

function collectBundleFiles(root: string): {
  files: string[];
  byteSize: number;
} {
  const files: string[] = [];
  let byteSize = 0;
  let scannedEntries = 0;
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      scannedEntries++;
      if (scannedEntries > MAX_SCANNED_ENTRIES) {
        throw new Error(`HTML bundle exceeds ${MAX_SCANNED_ENTRIES} scanned entries.`);
      }
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (isHiddenRelativePath(relative)) continue;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`HTML bundle cannot contain symlink "${relative}".`);
      }
      if (stat.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!ALLOWED_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`HTML bundle file "${relative}" exceeds ${MAX_FILE_BYTES} bytes.`);
      }
      files.push(relative.replace(/\\/g, '/'));
      byteSize += stat.size;
      if (files.length > MAX_FILES) {
        throw new Error(`HTML bundle exceeds ${MAX_FILES} materialized files.`);
      }
      if (byteSize > MAX_TOTAL_BYTES) {
        throw new Error(`HTML bundle exceeds ${MAX_TOTAL_BYTES} total bytes.`);
      }
    }
  };
  visit(root);
  files.sort();
  return { files, byteSize };
}

function extractUrls(content: string): Array<{
  url: string;
  context: string;
}> {
  const urls: Array<{ url: string; context: string }> = [];
  const attributePattern =
    /<(script|link|img|source|video|audio|a)\b[^>]*?\b(src|href|poster)=["']([^"']+)["'][^>]*>/gi;
  for (const match of content.matchAll(attributePattern)) {
    urls.push({
      url: match[3],
      context: `${match[1].toLowerCase()}.${match[2].toLowerCase()}`,
    });
  }
  const cssPattern = /(?:url\(\s*|@import\s+)(?:["']?)([^"')\s;]+)(?:["']?)\s*\)?/gi;
  for (const match of content.matchAll(cssPattern)) {
    urls.push({ url: match[1], context: 'css.resource' });
  }
  const srcsetPattern = /\bsrcset=["']([^"']+)["']/gi;
  for (const match of content.matchAll(srcsetPattern)) {
    for (const candidate of match[1].split(',')) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) urls.push({ url, context: 'img.srcset' });
    }
  }
  return urls;
}

function validateMarkupStructure(content: string, relativePath: string): void {
  if (/<\s*(iframe|object|embed|base|form)\b/i.test(content)) {
    throw new Error(
      `HTML bundle "${relativePath}" contains an unsupported embedded or navigational element.`,
    );
  }
  if (/<meta\b[^>]*http-equiv=["']?refresh/i.test(content)) {
    throw new Error(`HTML bundle "${relativePath}" contains a meta refresh.`);
  }
}

function validateResourceUrl(input: {
  url: string;
  context: string;
  sourceFile: string;
  root: string;
  includedFiles: ReadonlySet<string>;
  externalUrls: Set<string>;
}): void {
  const raw = input.url.trim();
  if (!raw || raw.startsWith('#')) return;
  const lowered = raw.toLowerCase();
  if (
    lowered.startsWith('javascript:')
    || lowered.startsWith('vbscript:')
    || lowered.startsWith('file:')
    || lowered.startsWith('data:text/html')
    || lowered.startsWith('//')
  ) {
    throw new Error(`HTML bundle contains unsafe URL "${raw}".`);
  }
  if (/^https?:/i.test(raw)) {
    if (input.context === 'script.src') {
      throw new Error('External scripts are not allowed in archived HTML bundles.');
    }
    input.externalUrls.add(raw);
    return;
  }
  if (
    lowered.startsWith('data:')
    || lowered.startsWith('blob:')
    || lowered.startsWith('mailto:')
    || lowered.startsWith('tel:')
  ) {
    return;
  }
  if (raw.startsWith('/')) {
    throw new Error(`Root-relative URL "${raw}" is outside the archived bundle.`);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
  } catch {
    throw new Error(`HTML bundle contains malformed URL "${raw}".`);
  }
  if (!decoded) return;
  const resolved = path.resolve(
    input.root,
    path.dirname(input.sourceFile),
    decoded,
  );
  const relative = path.relative(input.root, resolved).replace(/\\/g, '/');
  assertSafeRelativePath(relative);
  if (!input.includedFiles.has(relative)) {
    throw new Error(
      `HTML bundle resource "${raw}" from "${input.sourceFile}" was not materialized.`,
    );
  }
}

export function inspectHtmlBundle(
  sourceRoot: string,
  entryFileInput: string,
): HtmlBundleInspection {
  const root = fs.realpathSync(path.resolve(sourceRoot));
  const entryFile = assertSafeRelativePath(entryFileInput);
  if (!['.html', '.htm'].includes(path.extname(entryFile).toLowerCase())) {
    throw new Error('HTML bundle entry file must be .html or .htm.');
  }
  const entryPath = path.resolve(root, entryFile);
  const entryRelative = path.relative(root, entryPath).replace(/\\/g, '/');
  assertSafeRelativePath(entryRelative);
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    throw new Error(`HTML bundle entry "${entryFile}" does not exist.`);
  }

  const { files, byteSize } = collectBundleFiles(root);
  const includedFiles = new Set(files);
  if (!includedFiles.has(entryFile)) {
    throw new Error(`HTML bundle entry "${entryFile}" is not materializable.`);
  }
  const externalUrls = new Set<string>();
  for (const relative of files) {
    const ext = path.extname(relative).toLowerCase();
    if (!['.html', '.htm', '.css'].includes(ext)) continue;
    const content = fs.readFileSync(path.join(root, relative), 'utf8');
    if (ext === '.html' || ext === '.htm') {
      validateMarkupStructure(content, relative);
    }
    for (const candidate of extractUrls(content)) {
      validateResourceUrl({
        ...candidate,
        sourceFile: relative,
        root,
        includedFiles,
        externalUrls,
      });
    }
  }

  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relative)));
    hash.update('\0');
  }
  return {
    root,
    entryFile,
    files,
    byteSize,
    contentHash: `sha256:${hash.digest('hex')}`,
    externalUrls: Array.from(externalUrls).sort(),
  };
}

export function copyInspectedHtmlBundle(
  inspection: HtmlBundleInspection,
  destinationRoot: string,
): void {
  for (const relative of inspection.files) {
    const destination = path.join(destinationRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(inspection.root, relative), destination);
  }
}
