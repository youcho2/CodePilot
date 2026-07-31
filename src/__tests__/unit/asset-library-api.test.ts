import '../db-isolation.setup';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { createSession, getDb } from '@/lib/db';
import {
  addAssetReference,
  getAssetRecord,
  releaseAssetReference,
} from '@/lib/assets/service';
import { GET as getKinds } from '@/app/api/assets/kinds/route';
import { POST as archiveHtml } from '@/app/api/assets/html-bundles/route';
import { GET as getGallery } from '@/app/api/media/gallery/route';
import { GET as getAssetDetail } from '@/app/api/assets/[id]/route';
import { DELETE as deleteMedia } from '@/app/api/media/[id]/route';
import { PUT as toggleFavorite } from '@/app/api/media/[id]/favorite/route';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-api-workspace-'));
const pageDir = path.join(workspace, 'site');
fs.mkdirSync(pageDir, { recursive: true });
fs.writeFileSync(
  path.join(pageDir, 'index.html'),
  '<!doctype html><html><head><title>API Archive Title</title></head><body><h1>API archive</h1></body></html>',
  'utf8',
);
const session = createSession(
  'Asset API',
  'test-model',
  '',
  workspace,
  'code',
  'test-provider',
);

after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function request(
  url: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
): NextRequest {
  return new NextRequest(`http://localhost${url}`, init);
}

describe('Asset Library API', () => {
  let archivedAssetId = '';

  it('exposes only registered kinds', async () => {
    const response = await getKinds();
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(
      data.kinds.map((kind: { id: string }) => kind.id),
      ['image', 'video', 'audio', 'html_bundle'],
    );
    assert.equal(
      data.kinds.some((kind: { id: string }) => kind.id === 'component'),
      false,
    );
  });

  it('archives a workspace HTML bundle using session-derived scope and provenance', async () => {
    const response = await archiveHtml(request('/api/assets/html-bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        source: 'workspace',
        filePath: path.join(pageDir, 'index.html'),
        prompt: 'API-created archive',
      }),
    }));
    assert.equal(response.status, 200);
    const data = await response.json();
    archivedAssetId = data.asset.id;
    const asset = getAssetRecord(archivedAssetId)!;
    assert.equal(asset.project_id, path.basename(workspace));
    assert.equal(asset.provider_id, 'test-provider');
    assert.equal(asset.model_id, 'test-model');
    assert.equal(asset.session_id, session.id);
  });

  it('rejects a workspace path that the session does not own', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-api-outside-'));
    fs.writeFileSync(path.join(outside, 'index.html'), '<h1>outside</h1>');
    const response = await archiveHtml(request('/api/assets/html-bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        source: 'workspace',
        filePath: path.join(outside, 'index.html'),
      }),
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'materialization_failed');
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('orders the Gallery stably by Asset creation time and then id', async () => {
    fs.writeFileSync(
      path.join(pageDir, 'older.html'),
      '<!doctype html><title>Older archive</title>',
      'utf8',
    );
    fs.writeFileSync(
      path.join(pageDir, 'newer.html'),
      '<!doctype html><title>Newer archive</title>',
      'utf8',
    );
    const archive = async (fileName: string) => {
      const response = await archiveHtml(request('/api/assets/html-bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          source: 'workspace',
          filePath: path.join(pageDir, fileName),
        }),
      }));
      assert.equal(response.status, 200);
      return (await response.json()).asset.id as string;
    };
    const olderId = await archive('older.html');
    const newerId = await archive('newer.html');
    getDb().prepare(
      `UPDATE asset_records
       SET created_at = CASE id
         WHEN ? THEN '2026-01-01T00:00:00.000Z'
         WHEN ? THEN '2026-01-02T00:00:00.000Z'
         WHEN ? THEN '2026-01-03T00:00:00.000Z'
       END
       WHERE id IN (?, ?, ?)`,
    ).run(
      olderId,
      archivedAssetId,
      newerId,
      olderId,
      archivedAssetId,
      newerId,
    );

    const newest = await getGallery(request(
      '/api/media/gallery?kind=html_bundle&sort=newest',
    ));
    assert.deepEqual(
      (await newest.json()).items.map((item: { id: string }) => item.id),
      [newerId, archivedAssetId, olderId],
    );
    const oldest = await getGallery(request(
      '/api/media/gallery?kind=html_bundle&sort=oldest',
    ));
    assert.deepEqual(
      (await oldest.json()).items.map((item: { id: string }) => item.id),
      [olderId, archivedAssetId, newerId],
    );

    for (const id of [olderId, newerId]) {
      const deleted = await deleteMedia(
        request(`/api/media/${id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id }) },
      );
      assert.equal(deleted.status, 200);
    }
  });

  it('lists registry-backed Assets and returns strict HTML preview metadata', async () => {
    const gallery = await getGallery(request(
      '/api/media/gallery?kind=html_bundle&query=API%20Archive%20Title',
    ));
    assert.equal(gallery.status, 200);
    const galleryData = await gallery.json();
    assert.equal(galleryData.total, 1);
    assert.equal(galleryData.items[0].id, archivedAssetId);
    assert.equal(galleryData.items[0].type, 'html_bundle');
    assert.equal(galleryData.items[0].title, 'API Archive Title');
    assert.match(
      galleryData.items[0].previewUrl,
      /^\/api\/files\/html-preview\/ws\./,
    );
    assert.equal(galleryData.items[0].previewUrl.includes('interactive=1'), false);

    const detail = await getAssetDetail(
      request(`/api/assets/${archivedAssetId}`),
      { params: Promise.resolve({ id: archivedAssetId }) },
    );
    assert.equal(detail.status, 200);
    const detailData = await detail.json();
    assert.equal(detailData.typedRef.assetId, archivedAssetId);
    assert.deepEqual(detailData.consumers, []);

    const invalidKind = await getGallery(request(
      '/api/media/gallery?kind=component',
    ));
    assert.equal(invalidKind.status, 400);
    assert.equal((await invalidKind.json()).code, 'kind_unregistered');
  });

  it('favorites HTML Assets through the existing Gallery action', async () => {
    const response = await toggleFavorite(
      request(`/api/media/${archivedAssetId}/favorite`, { method: 'PUT' }),
      { params: Promise.resolve({ id: archivedAssetId }) },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).favorited, 1);
    assert.equal(getAssetRecord(archivedAssetId)?.curation_state, 'selected');
  });

  it('keeps old media rows available during the additive migration', () => {
    const asset = getAssetRecord(archivedAssetId)!;
    assert.equal(asset.source_media_generation_id, null);
    assert.equal(
      (getDb().prepare(
        'SELECT COUNT(*) AS count FROM media_generations',
      ).get() as { count: number }).count,
      0,
    );
  });

  it('blocks permanent deletion while referenced, then removes the record and owned bytes', async () => {
    addAssetReference({
      assetId: archivedAssetId,
      consumerType: 'harness_manifest',
      consumerId: 'harness:api-test',
    });
    const blocked = await deleteMedia(
      request(`/api/media/${archivedAssetId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: archivedAssetId }) },
    );
    assert.equal(blocked.status, 409);
    const blockedData = await blocked.json();
    assert.equal(blockedData.code, 'asset_in_use');
    assert.equal(blockedData.consumers.length, 1);

    releaseAssetReference({
      assetId: archivedAssetId,
      consumerType: 'harness_manifest',
      consumerId: 'harness:api-test',
    });
    const stablePath = getAssetRecord(archivedAssetId)!.stable_path;
    const assetRoot = path.dirname(path.dirname(stablePath));
    const deleted = await deleteMedia(
      request(`/api/media/${archivedAssetId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: archivedAssetId }) },
    );
    assert.equal(deleted.status, 200);
    const deletedData = await deleted.json();
    assert.equal(deletedData.permanent, true);
    assert.equal(deletedData.recoverable, false);
    assert.equal(deletedData.fileDeleted, true);
    assert.equal(fs.existsSync(stablePath), false);
    assert.equal(fs.existsSync(assetRoot), false);
    assert.equal(getAssetRecord(archivedAssetId), undefined);

    const activeGallery = await getGallery(request(
      '/api/media/gallery?kind=html_bundle',
    ));
    assert.equal((await activeGallery.json()).total, 0);
  });
});
