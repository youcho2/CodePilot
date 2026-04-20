import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { readFilePreview, isPathSafe, isRootPath, FilePreviewError } from '@/lib/files';
import type { FilePreviewResponse, ErrorResponse } from '@/types';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const filePath = searchParams.get('path');

  // maxLines is a hint / cap, not a default. When absent, readFilePreview
  // picks a per-extension cap (50k for Markdown/text, 1k for code).
  const maxLinesParam = searchParams.get('maxLines');
  const userMaxLines = maxLinesParam ? parseInt(maxLinesParam, 10) : undefined;

  if (!filePath) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing path parameter' },
      { status: 400 }
    );
  }

  const resolvedPath = path.resolve(filePath);
  const homeDir = os.homedir();

  // Validate that the file is within the session's working directory.
  // baseDir may be on a different drive than homeDir on Windows.
  // Only reject root paths as baseDir to prevent full-disk access.
  const baseDir = searchParams.get('baseDir');
  const resolvedBase = baseDir ? path.resolve(baseDir) : homeDir;
  if (baseDir && isRootPath(resolvedBase)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Cannot use filesystem root as base directory' },
      { status: 403 }
    );
  }
  if (!isPathSafe(resolvedBase, resolvedPath)) {
    return NextResponse.json<ErrorResponse>(
      { error: baseDir ? 'File is outside the project scope' : 'File is outside the allowed scope' },
      { status: 403 }
    );
  }

  // Symlink defense (Codex P1 follow-up).
  //
  // The textual isPathSafe check above validates `resolvedPath` alone —
  // but every downstream fs call (stat / open / createReadStream) follows
  // symlinks. Without this extra gate, a file `workspace/leak.md →
  // /etc/passwd` passes isPathSafe as a workspace path and then serves
  // the symlink target's contents. fs.realpath resolves symlinks + `..`
  // and gives us the real backing location; we re-check that real
  // location still sits inside resolvedBase before reading anything.
  //
  // ENOENT here means the path doesn't exist yet (e.g. user typed a name
  // into the URL). Let readFilePreview handle it — its FilePreviewError
  // path produces a proper 404.
  try {
    const realPath = await fs.realpath(resolvedPath);
    if (!isPathSafe(resolvedBase, realPath)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Symlink target escapes base directory', code: 'symlink_escape' },
        { status: 403 }
      );
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to resolve real path', code: 'realpath_failed' },
        { status: 500 }
      );
    }
    // ENOENT → fall through, readFilePreview will 404.
  }

  try {
    const preview = await readFilePreview(resolvedPath, userMaxLines);
    return NextResponse.json<FilePreviewResponse>({ preview });
  } catch (error) {
    if (error instanceof FilePreviewError) {
      // Map structured preview errors to appropriate HTTP codes + error codes
      // so UI can branch on kind (file too large vs binary vs missing).
      const status =
        error.code === 'not_found' ? 404 :
        error.code === 'file_too_large' ? 413 :
        error.code === 'binary_not_previewable' ? 415 :
        error.code === 'not_a_file' ? 400 :
        500;
      return NextResponse.json<ErrorResponse>(
        { error: error.message, code: error.code, ...error.meta },
        { status }
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to read file' },
      { status: 500 }
    );
  }
}
