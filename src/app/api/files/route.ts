import { NextRequest, NextResponse } from 'next/server';
import { scanDirectory, isPathSafe } from '@/lib/files';
import type { FileTreeResponse, ErrorResponse } from '@/types';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const dir = searchParams.get('dir');
  const depth = parseInt(searchParams.get('depth') || '3', 10);

  if (!dir) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing dir parameter' },
      { status: 400 }
    );
  }

  const path = require('path');
  const resolvedDir = path.resolve(dir);

  // Use baseDir (the session's working directory) as the trust boundary.
  // If no baseDir is provided, fall back to the requested directory itself
  // (preserves backward compatibility while still preventing traversal
  // when the frontend supplies the session working directory).
  const baseDir = searchParams.get('baseDir');
  if (baseDir) {
    const resolvedBase = path.resolve(baseDir);
    if (!isPathSafe(resolvedBase, resolvedDir)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Directory is outside the project scope' },
        { status: 403 }
      );
    }
  }

  try {
    const tree = scanDirectory(resolvedDir, Math.min(depth, 5));
    return NextResponse.json<FileTreeResponse>({ tree, root: resolvedDir });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to scan directory' },
      { status: 500 }
    );
  }
}
