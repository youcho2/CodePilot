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
      /useState\(true\)[\s\S]*showFilters|showFilters[\s\S]*useState\(true\)/,
    );
    assert.match(
      pageSource,
      /<Input[\s\S]*gallery\.favoritesOnly[\s\S]*gallery\.filters[\s\S]*gallery\.newestFirst/,
    );
    assert.match(pageSource, /showFilters && \([\s\S]*gallery\.kindAll[\s\S]*kinds\.map/);
    assert.doesNotMatch(pageSource, /type="date"|dateFrom|dateTo|clearFilters/);
  });

  it('uses a fixed-width row-major grid and a bounded 16:9 web preview', () => {
    assert.match(gridSource, /className="grid items-start gap-3"/);
    assert.match(gridSource, /gridTemplateColumns: 'repeat\(auto-fill, 16rem\)'/);
    assert.match(gridSource, /className="w-64 cursor-pointer/);
    assert.doesNotMatch(gridSource, /columnCount|breakInside/);

    assert.match(gridSource, /className="relative aspect-video w-full overflow-hidden/);
    assert.match(gridSource, /h-\[720px\] w-\[1280px\]/);
    assert.match(gridSource, /scale-\[0\.2\]/);
    assert.match(gridSource, /absolute left-2 top-2 rounded-full/);
    assert.match(gridSource, /\{displayTitle\}/);
  });

  it('renders real audio and strict static HTML previews with an honest failure state', () => {
    assert.match(gridSource, /item\.type === 'audio'/);
    assert.match(gridSource, /item\.type === 'html_bundle'/);
    assert.match(gridSource, /sandbox=""/);
    assert.match(gridSource, /item\.integrityState === 'missing'/);
    assert.match(detailSource, /<audio/);
    assert.match(detailSource, /sandbox=""/);
    assert.doesNotMatch(detailSource, /allow-scripts|allow-same-origin/);
  });

  it('archives only explicit HTML previews through the scoped materializer API', () => {
    assert.match(archiveClientSource, /\/api\/assets\/html-bundles/);
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
