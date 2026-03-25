import { NextRequest, NextResponse } from 'next/server';
import { importFileToLibrary } from '@/lib/media-saver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ImportRequest {
  filePath: string;
  mimeType?: string;
  title?: string;
  tags?: string[];
  sessionId?: string;
  source?: string;
}

/**
 * Import an existing local file into the media library.
 * Used by CLI tools (via Claude's curl) to save generated images/videos.
 *
 * POST /api/media/import
 * Body: { filePath, mimeType?, title?, tags?, sessionId?, source? }
 */
export async function POST(request: NextRequest) {
  try {
    const body: ImportRequest = await request.json();

    if (!body.filePath) {
      return NextResponse.json(
        { error: 'filePath is required' },
        { status: 400 }
      );
    }

    const result = importFileToLibrary(body.filePath, {
      mimeType: body.mimeType,
      prompt: body.title,
      tags: body.tags,
      sessionId: body.sessionId,
      source: body.source,
    });

    return NextResponse.json({
      id: result.mediaId,
      localPath: result.localPath,
      galleryUrl: `/gallery?highlight=${result.mediaId}`,
    });
  } catch (error) {
    console.error('[media/import] Failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to import media';
    return NextResponse.json(
      { error: message },
      { status: error instanceof Error && error.message.includes('not found') ? 404 : 500 }
    );
  }
}
