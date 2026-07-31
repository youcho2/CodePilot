import { NextRequest, NextResponse } from 'next/server';
import {
  getAssetRecord,
  normalizeAssetTags,
  parseStoredAssetTags,
  setAssetTags,
} from '@/lib/assets/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
) {
  const { id } = await params;
  const asset = getAssetRecord(id);
  if (!asset || asset.lifecycle_state !== 'active') {
    return NextResponse.json(
      { error: 'Asset not found.', code: 'asset_not_found' },
      { status: 404 },
    );
  }
  return NextResponse.json({ tags: parseStoredAssetTags(asset.tags) });
}

export async function PUT(
  request: NextRequest,
  { params }: RouteParams,
) {
  try {
    const { id } = await params;
    const body = await request.json() as { tags?: unknown };
    if (!Array.isArray(body.tags)) {
      return NextResponse.json(
        { error: 'tags must be an array.', code: 'tags_invalid' },
        { status: 400 },
      );
    }
    const tags = normalizeAssetTags(body.tags as string[]);
    return NextResponse.json({ tags: setAssetTags(id, tags) });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Failed to update Asset tags.';
    if (message.includes('does not exist')) {
      return NextResponse.json(
        { error: message, code: 'asset_not_found' },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: message, code: 'tags_invalid' },
      { status: 400 },
    );
  }
}
