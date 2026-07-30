import '../db-isolation.setup';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDb, migrateAssetLibrarySchema } from '@/lib/db';
import {
  addAssetLineage,
  addAssetReference,
  AssetInUseError,
  backfillMediaAssets,
  getAssetLineage,
  getAssetRecord,
  listAssetConsumers,
  releaseAssetReference,
  restoreAsset,
  toTypedAssetRef,
  trashAsset,
} from '@/lib/assets/service';
import { getAssetKind, listAssetKinds } from '@/lib/assets/kind-registry';
import {
  getMediaDir,
  importFileToLibrary,
  saveMediaToLibrary,
} from '@/lib/media-saver';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function minimalWav(): Buffer {
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(0, 40);
  return buffer;
}

function insertLegacyMedia(input: {
  id: string;
  type: 'image' | 'video' | 'audio';
  status?: 'completed' | 'failed' | 'processing';
  localPath: string;
  mimeType: string;
}): void {
  getDb().prepare(
    `INSERT INTO media_generations (
       id, type, status, provider, model, prompt, local_path,
       thumbnail_path, tags, metadata, created_at, completed_at
     ) VALUES (?, ?, ?, 'legacy', 'legacy-model', 'legacy prompt', ?,
       '', '[]', ?, datetime('now'), datetime('now'))`,
  ).run(
    input.id,
    input.type,
    input.status ?? 'completed',
    input.localPath,
    JSON.stringify({ mimeType: input.mimeType }),
  );
}

describe('Harness Home Asset Library conformance', () => {
  it('registers only real producer → materializer → validator → consumer chains', () => {
    const kinds = listAssetKinds();
    assert.deepEqual(kinds.map((kind) => kind.id), ['image', 'video', 'audio']);
    assert.equal(getAssetKind('component'), undefined);
    assert.equal(getAssetKind('document'), undefined);
    for (const kind of kinds) {
      assert.ok(kind.producers.length > 0);
      assert.ok(kind.materializer);
      assert.ok(kind.validator);
      assert.ok(kind.previewConsumer);
      assert.ok(kind.inputConsumers.length > 0);
      assert.ok(kind.trustPolicy);
      assert.ok(kind.conformanceSuite);
    }
  });

  it('materializes image, video, and real WAV fixtures with provenance and hashes', () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-conformance-'));
    const videoPath = path.join(sourceDir, 'sample.mp4');
    const audioPath = path.join(sourceDir, 'sample.wav');
    fs.writeFileSync(videoPath, Buffer.from('real-test-video-bytes'));
    fs.writeFileSync(audioPath, minimalWav());

    try {
      const image = saveMediaToLibrary(
        { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
        {
          source: 'mcp',
          producerId: 'media-saver:base64',
          runtimeId: 'codepilot_runtime',
          methodRef: 'method:test-image',
          prompt: 'one pixel',
        },
      );
      const video = importFileToLibrary(videoPath, {
        mimeType: 'video/mp4',
        producerId: 'media-saver:file-import',
        source: 'test-import',
      });
      const audio = importFileToLibrary(audioPath, {
        mimeType: 'audio/wav',
        producerId: 'media-saver:file-import',
        source: 'test-import',
      });

      const imageAsset = getAssetRecord(image.assetId)!;
      const videoAsset = getAssetRecord(video.assetId)!;
      const audioAsset = getAssetRecord(audio.assetId)!;
      assert.equal(imageAsset.kind, 'image');
      assert.equal(videoAsset.kind, 'video');
      assert.equal(audioAsset.kind, 'audio');
      assert.equal(imageAsset.runtime_id, 'codepilot_runtime');
      assert.equal(imageAsset.method_ref, 'method:test-image');
      assert.equal(imageAsset.integrity_state, 'valid');
      assert.match(imageAsset.content_hash, /^sha256:[a-f0-9]{64}$/);
      assert.ok(imageAsset.stable_path.startsWith(fs.realpathSync(getMediaDir())));
      assert.equal(fs.readFileSync(audioAsset.stable_path).subarray(0, 4).toString(), 'RIFF');
      assert.deepEqual(toTypedAssetRef(videoAsset), {
        assetId: videoAsset.id,
        kind: 'video',
        contentHash: videoAsset.content_hash,
      });
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('keeps duplicate bytes as distinct provenance records with the same hash', () => {
    const first = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'first provenance' },
    );
    const second = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'second provenance' },
    );
    const firstAsset = getAssetRecord(first.assetId)!;
    const secondAsset = getAssetRecord(second.assetId)!;
    assert.notEqual(firstAsset.id, secondAsset.id);
    assert.equal(firstAsset.content_hash, secondAsset.content_hash);
    assert.notEqual(firstAsset.prompt, secondAsset.prompt);
  });

  it('rolls back bytes and media rows when kind or producer validation fails', () => {
    const mediaDir = getMediaDir();
    const rowsBefore = (getDb().prepare(
      'SELECT COUNT(*) AS count FROM media_generations',
    ).get() as { count: number }).count;
    const filesBefore = fs.readdirSync(mediaDir).length;

    assert.throws(
      () => saveMediaToLibrary(
        { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
        { producerId: 'unregistered-producer' },
      ),
      /not registered/,
    );
    assert.throws(
      () => saveMediaToLibrary(
        {
          type: 'image',
          mimeType: 'application/octet-stream',
          data: Buffer.from('not a registered media kind').toString('base64'),
        },
      ),
      /does not match MIME type/,
    );

    const rowsAfter = (getDb().prepare(
      'SELECT COUNT(*) AS count FROM media_generations',
    ).get() as { count: number }).count;
    assert.equal(rowsAfter, rowsBefore);
    assert.equal(fs.readdirSync(mediaDir).length, filesBefore);
  });

  it('backfills legacy rows idempotently without claiming missing or partial bytes are valid', () => {
    const mediaDir = getMediaDir();
    fs.mkdirSync(mediaDir, { recursive: true });
    const validPath = path.join(mediaDir, 'legacy-valid.png');
    const missingPath = path.join(mediaDir, 'legacy-missing.png');
    fs.writeFileSync(validPath, Buffer.from(PNG_BASE64, 'base64'));
    insertLegacyMedia({
      id: 'legacy-valid-asset',
      type: 'image',
      localPath: validPath,
      mimeType: 'image/png',
    });
    insertLegacyMedia({
      id: 'legacy-missing-asset',
      type: 'image',
      localPath: missingPath,
      mimeType: 'image/png',
    });
    insertLegacyMedia({
      id: 'legacy-partial-asset',
      type: 'image',
      status: 'processing',
      localPath: validPath,
      mimeType: 'image/png',
    });

    const first = backfillMediaAssets(100);
    assert.ok(first.created >= 2);
    assert.equal(getAssetRecord('legacy-valid-asset')?.integrity_state, 'valid');
    assert.equal(getAssetRecord('legacy-missing-asset')?.integrity_state, 'missing');
    assert.equal(getAssetRecord('legacy-partial-asset'), undefined);

    const second = backfillMediaAssets(100);
    assert.equal(second.created, 0);
    assert.equal(second.remaining, 0);
  });

  it('tracks acyclic lineage and protects active consumers from recoverable deletion', () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-lineage-'));
    const videoPath = path.join(sourceDir, 'derived.mp4');
    fs.writeFileSync(videoPath, Buffer.from('derived-video-bytes'));
    const parent = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'parent' },
    );
    const child = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'child', parentAssetIds: [parent.assetId] },
    );
    const grandchild = importFileToLibrary(videoPath, {
      mimeType: 'video/mp4',
      prompt: 'derived video',
      parentAssetIds: [child.assetId],
    });
    fs.rmSync(sourceDir, { recursive: true, force: true });
    assert.equal(getAssetLineage(child.assetId).parents.length, 1);
    assert.equal(getAssetRecord(grandchild.assetId)?.kind, 'video');
    assert.throws(
      () => addAssetLineage({
        parentAssetId: grandchild.assetId,
        childAssetId: parent.assetId,
        relation: 'derived_from',
      }),
      /cycle/,
    );
    assert.throws(
      () => trashAsset(parent.assetId),
      (error: unknown) => (
        error instanceof AssetInUseError
        && error.consumers.some((consumer) => consumer.type === 'asset_lineage')
      ),
    );

    const standalone = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'referenced standalone' },
    );
    addAssetReference({
      assetId: standalone.assetId,
      consumerType: 'harness_manifest',
      consumerId: 'harness:test',
    });
    assert.equal(listAssetConsumers(standalone.assetId).length, 1);
    assert.throws(
      () => trashAsset(standalone.assetId),
      (error: unknown) => error instanceof AssetInUseError,
    );
    assert.equal(releaseAssetReference({
      assetId: standalone.assetId,
      consumerType: 'harness_manifest',
      consumerId: 'harness:test',
    }), true);
    const stablePath = getAssetRecord(standalone.assetId)!.stable_path;
    assert.equal(trashAsset(standalone.assetId).lifecycle_state, 'trashed');
    assert.equal(fs.existsSync(stablePath), true);
    assert.ok(getDb().prepare(
      'SELECT id FROM media_generations WHERE id = ?',
    ).get(standalone.mediaId));
    assert.equal(restoreAsset(standalone.assetId).lifecycle_state, 'active');
  });

  it('applies the additive schema idempotently without mutating legacy media rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE media_generations (
        id TEXT PRIMARY KEY
      );
      INSERT INTO media_generations (id) VALUES ('legacy-row');
    `);
    migrateAssetLibrarySchema(db);
    migrateAssetLibrarySchema(db);
    const tables = db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'asset_%'
       ORDER BY name`,
    ).all() as { name: string }[];
    assert.deepEqual(tables.map((row) => row.name), [
      'asset_backfill_state',
      'asset_lineage',
      'asset_records',
      'asset_references',
    ]);
    assert.equal(
      (db.prepare(
        'SELECT COUNT(*) AS count FROM media_generations',
      ).get() as { count: number }).count,
      1,
    );
    db.close();
  });
});
