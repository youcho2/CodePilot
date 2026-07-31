import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  assertRealPathInBase,
  FileIOError,
  isPathSafe,
  isRootPath,
} from '@/lib/files';
import type { ErrorResponse, FileInspectResponse } from '@/types';

function fileErrorStatus(error: FileIOError): number {
  if (error.code === 'path_unsafe' || error.code === 'symlink_detected') return 403;
  if (error.code === 'not_found') return 404;
  return 500;
}

/** Lightweight, scoped file-vs-directory probe for chat local references. */
export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');
  if (!filePath) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing path parameter', code: 'invalid_request' },
      { status: 400 },
    );
  }

  const baseDir = request.nextUrl.searchParams.get('baseDir');
  const resolvedBase = path.resolve(baseDir || os.homedir());
  const resolvedPath = path.resolve(filePath);

  if (baseDir && isRootPath(resolvedBase)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Cannot use filesystem root as base directory', code: 'root_path' },
      { status: 403 },
    );
  }
  if (!isPathSafe(resolvedBase, resolvedPath)) {
    return NextResponse.json<ErrorResponse>(
      {
        error: baseDir
          ? 'Path is outside the project scope'
          : 'Path is outside the allowed scope',
        code: 'path_unsafe',
      },
      { status: 403 },
    );
  }

  try {
    const realPath = await assertRealPathInBase(resolvedPath, baseDir || undefined);
    if (!realPath) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Path does not exist', code: 'not_found' },
        { status: 404 },
      );
    }
    const stat = await fs.stat(/*turbopackIgnore: true*/ realPath);
    const kind = stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
    return NextResponse.json<FileInspectResponse>({ kind });
  } catch (error) {
    if (error instanceof FileIOError) {
      return NextResponse.json<ErrorResponse>(
        { error: error.message, code: error.code, ...error.meta },
        { status: fileErrorStatus(error) },
      );
    }
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Path does not exist', code: 'not_found' },
        { status: 404 },
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to inspect path' },
      { status: 500 },
    );
  }
}
