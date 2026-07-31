import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src');
const pageSource = fs.readFileSync(
  path.join(root, 'app/gallery/page.tsx'),
  'utf8',
);
const gridSource = fs.readFileSync(
  path.join(root, 'components/gallery/GalleryGrid.tsx'),
  'utf8',
);
const detailSource = fs.readFileSync(
  path.join(root, 'components/gallery/GalleryDetail.tsx'),
  'utf8',
);
const previewSource = fs.readFileSync(
  path.join(root, 'components/layout/panels/PreviewPanel.tsx'),
  'utf8',
);
const diffSummarySource = fs.readFileSync(
  path.join(root, 'components/chat/DiffSummary.tsx'),
  'utf8',
);
const messageItemSource = fs.readFileSync(
  path.join(root, 'components/chat/MessageItem.tsx'),
  'utf8',
);
const archiveClientSource = fs.readFileSync(
  path.join(root, 'lib/archive-html-asset-client.ts'),
  'utf8',
);
const enSource = fs.readFileSync(path.join(root, 'i18n/en.ts'), 'utf8');
const zhSource = fs.readFileSync(path.join(root, 'i18n/zh.ts'), 'utf8');

describe('Asset Library UI contract', () => {
  it('derives kind filters from the registry API instead of hard-coded candidates', () => {
    assert.match(pageSource, /fetch\('\/api\/assets\/kinds'\)/);
    assert.match(pageSource, /kinds\.map\(/);
    assert.match(pageSource, /params\.set\('kind', kind\)/);
    assert.match(pageSource, /KIND_ICONS/);
    assert.match(pageSource, /name=\{KIND_ICONS\[entry\.id\] \|\| 'artifact'\}/);
    assert.doesNotMatch(pageSource, /component.*document|document.*component/);
  });

  it('keeps search and primary actions together with kind filters expanded below', () => {
    assert.match(
      pageSource,
      /<Input[\s\S]*gallery\.favoritesOnly[\s\S]*gallery\.newestFirst/,
    );
    assert.match(pageSource, /max-w-sm flex-none/);
    assert.match(pageSource, /gallery\.kindAll[\s\S]*kinds\.map/);
    assert.doesNotMatch(pageSource, /showFilters|gallery\.filters|name="filter"/);
    assert.doesNotMatch(pageSource, /type="date"|dateFrom|dateTo|clearFilters/);
  });

  it('uses a fill-width measured masonry with a bounded 16:9 web preview', () => {
    assert.match(gridSource, /MIN_COLUMN_WIDTH/);
    assert.match(gridSource, /columnCount/);
    assert.match(gridSource, /columnHeights/);
    assert.match(gridSource, /ResizeObserver/);
    assert.match(gridSource, /containerWidth - COLUMN_GAP \* \(columnCount - 1\)/);
    assert.match(gridSource, /className="absolute"/);
    assert.match(gridSource, /className="relative aspect-video w-full overflow-hidden/);
    assert.match(gridSource, /item\.thumbnailUrl/);
    assert.match(gridSource, /\{displayTitle\}/);
  });

  it('renders real audio and static HTML images with an honest failure state', () => {
    assert.match(gridSource, /item\.type === 'audio'/);
    assert.match(gridSource, /item\.type === 'html_bundle'/);
    assert.doesNotMatch(gridSource, /<iframe|sandbox=/);
    assert.doesNotMatch(gridSource, /gallery\.staticWebPreview/);
    assert.match(gridSource, /item\.integrityState === 'missing'/);
    assert.match(detailSource, /<audio/);
    assert.match(detailSource, /item\.thumbnailUrl/);
    assert.doesNotMatch(detailSource, /<iframe|sandbox=|allow-scripts|allow-same-origin/);
  });

  it('archives only explicit HTML previews through the scoped materializer API', () => {
    assert.match(archiveClientSource, /\/api\/assets\/html-bundles/);
    assert.match(archiveClientSource, /ensureHtmlAssetThumbnail/);
    assert.match(previewSource, /archiveHtmlAsset/);
    assert.match(previewSource, /sessionId/);
    assert.match(previewSource, /sourceTrust === 'workspace'/);
    assert.match(previewSource, /filePreview\.archiveAsset\.failed/);
  });

  it('offers the same scoped archive action on workspace HTML chat cards', () => {
    assert.match(diffSummarySource, /onArchiveHtml/);
    assert.match(diffSummarySource, /filePreview\.archiveAsset/);
    assert.match(messageItemSource, /archiveHtmlAsset/);
    assert.match(messageItemSource, /classifyPath\(resolvedPath, workingDirectory\)/);
    assert.match(messageItemSource, /trust === 'workspace'/);
  });

  it('uses permanent-delete confirmation copy and exposes no Trash/Restore UI', () => {
    for (const source of [enSource, zhSource]) {
      assert.match(source, /'gallery\.deleteFailed'/);
      assert.match(source, /'gallery\.deleteConfirm'/);
      assert.match(source, /'gallery\.deleteBlocked'/);
      assert.doesNotMatch(source, /'gallery\.(?:trash|activeAssets|moveToTrash|recoverableDelete|restore|restoreFailed|trashFailed)'/);
    }
    assert.match(detailSource, /gallery\.deleteConfirm/);
    assert.match(detailSource, /gallery\.confirmDelete/);
    assert.match(detailSource, /name="delete"/);
    assert.match(detailSource, /gallery\.deleteBlocked/);
    assert.doesNotMatch(detailSource, /restore|recoverableDelete|moveToTrash/);
    assert.doesNotMatch(pageSource, /showTrash|lifecycle|restore/);
  });

  it('surfaces provenance, integrity, lineage, and consumers from real fields', () => {
    for (const field of [
      'producerId',
      'projectId',
      'runtimeId',
      'methodRef',
      'integrityState',
    ]) {
      assert.match(detailSource, new RegExp(`item\\.${field}`));
    }
    assert.match(detailSource, /assetDetail\.lineage/);
    assert.match(detailSource, /assetDetail\.consumers/);
  });
});
