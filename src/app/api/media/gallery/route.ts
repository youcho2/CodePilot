import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { backfillMediaAssets } from '@/lib/assets/service';
import { getAssetKind } from '@/lib/assets/kind-registry';
import { getHtmlBundlePreviewLocation } from '@/lib/assets/html-bundle-materializer';
import { buildHtmlPreviewUrl } from '@/lib/html-preview-url';
import type { AssetRecord } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AssetGalleryRow extends AssetRecord {
  media_provider: string | null;
  media_model: string | null;
  aspect_ratio: string | null;
  image_size: string | null;
  tags: string | null;
  favorited: number | null;
  media_metadata: string | null;
}

function safeArray(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function mapRow(row: AssetGalleryRow) {
  const images: Array<{ mimeType: string; localPath: string }> = [];
  if (
    row.integrity_state === 'valid'
    && ['image', 'video', 'audio'].includes(row.kind)
    && row.stable_path
  ) {
    images.push({
      mimeType: row.mime_type,
      localPath: row.stable_path,
    });
  }
  let referenceImages:
    | Array<{ mimeType: string; localPath: string }>
    | undefined;
  try {
    const metadata = JSON.parse(row.media_metadata || '{}') as {
      referenceImages?: unknown;
    };
    if (Array.isArray(metadata.referenceImages)) {
      referenceImages = metadata.referenceImages.filter(
        (entry): entry is { mimeType: string; localPath: string } => (
          !!entry
          && typeof entry === 'object'
          && typeof (entry as { mimeType?: unknown }).mimeType === 'string'
          && typeof (entry as { localPath?: unknown }).localPath === 'string'
        ),
      );
    }
  } catch {
    // Legacy malformed metadata remains visible without reference images.
  }
  let previewUrl: string | undefined;
  if (row.kind === 'html_bundle' && row.integrity_state === 'valid') {
    try {
      const location = getHtmlBundlePreviewLocation(row);
      previewUrl = buildHtmlPreviewUrl(
        location.entryPath,
        { kind: 'workspace', baseDir: location.bundleRoot },
      );
    } catch {
      previewUrl = undefined;
    }
  }
  return {
    id: row.id,
    type: row.kind,
    kind: row.kind,
    producerId: row.producer_id,
    provider: row.provider_id || row.media_provider || undefined,
    prompt: row.prompt,
    images,
    previewUrl,
    model: row.model_id || row.media_model || undefined,
    aspectRatio: row.aspect_ratio || undefined,
    imageSize: row.image_size || undefined,
    tags: safeArray(row.tags),
    favorited: !!row.favorited || row.curation_state === 'selected',
    created_at: row.created_at,
    session_id: row.session_id || undefined,
    projectId: row.project_id || undefined,
    runtimeId: row.runtime_id || undefined,
    methodRef: row.method_ref || undefined,
    contentHash: row.content_hash,
    integrityState: row.integrity_state,
    integrityReason: row.integrity_reason || undefined,
    trustTier: row.trust_tier,
    lifecycleState: row.lifecycle_state,
    referenceImages,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const tags = searchParams.get('tags');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const favoritesOnly = searchParams.get('favoritesOnly') === '1';
    const sort = searchParams.get('sort') || 'newest';
    const kind = searchParams.get('kind');
    const query = searchParams.get('query')?.trim() || '';
    const lifecycle =
      searchParams.get('lifecycle') === 'trashed' ? 'trashed' : 'active';
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50),
    );
    const offset = Math.max(
      0,
      parseInt(searchParams.get('offset') || '0', 10) || 0,
    );
    if (kind && !getAssetKind(kind)) {
      return NextResponse.json(
        { error: `Asset kind "${kind}" is not registered.`, code: 'kind_unregistered' },
        { status: 400 },
      );
    }

    // Bounded on-read migration: old Gallery bytes remain untouched. Repeated
    // page loads continue the idempotent journal if a library is very large.
    backfillMediaAssets(100);

    const conditions = ['ar.lifecycle_state = ?'];
    const params: unknown[] = [lifecycle];
    if (favoritesOnly) {
      conditions.push(
        `COALESCE(
           mg.favorited,
           CASE WHEN ar.curation_state = 'selected' THEN 1 ELSE 0 END
         ) = 1`,
      );
    }
    if (kind) {
      conditions.push('ar.kind = ?');
      params.push(kind);
    }
    if (dateFrom) {
      conditions.push('ar.created_at >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('ar.created_at <= ?');
      params.push(dateTo);
    }
    if (query) {
      const search = `%${query}%`;
      conditions.push(
        `(ar.prompt LIKE ? OR ar.project_id LIKE ? OR ar.provider_id LIKE ?
          OR ar.model_id LIKE ? OR ar.method_ref LIKE ? OR ar.producer_id LIKE ?)`,
      );
      params.push(search, search, search, search, search, search);
    }
    const tagList = tags
      ? tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];
    if (tagList.length > 0) {
      const placeholders = tagList.map(() => '?').join(', ');
      conditions.push(
        `EXISTS (
           SELECT 1 FROM json_each(COALESCE(mg.tags, '[]'))
           WHERE json_each.value IN (${placeholders})
         )`,
      );
      params.push(...tagList);
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const orderDirection = sort === 'oldest' ? 'ASC' : 'DESC';
    const fromClause = `
      FROM asset_records ar
      LEFT JOIN media_generations mg
        ON mg.id = ar.source_media_generation_id
    `;
    const countResult = getDb().prepare(
      `SELECT COUNT(*) AS total ${fromClause} ${whereClause}`,
    ).get(...params) as { total: number };
    const rows = getDb().prepare(
      `SELECT
         ar.*,
         mg.provider AS media_provider,
         mg.model AS media_model,
         mg.aspect_ratio,
         mg.image_size,
         mg.tags,
         mg.favorited,
         mg.metadata AS media_metadata
       ${fromClause}
       ${whereClause}
       ORDER BY ar.created_at ${orderDirection}
       LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as AssetGalleryRow[];

    return NextResponse.json({
      items: rows.map(mapRow),
      total: countResult.total,
    });
  } catch (error) {
    console.error('[media/gallery] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Asset Library' },
      { status: 500 },
    );
  }
}
