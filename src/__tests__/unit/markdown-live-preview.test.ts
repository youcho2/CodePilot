import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';

import {
  buildMarkdownLivePreview,
  externalMarkdownValueSync,
  resolveMarkdownAssetUrl,
} from '../../components/editor/markdown-live-preview';

function decorationKinds(set: DecorationSet): string[] {
  const result: string[] = [];
  const cursor = set.iter();
  while (cursor.value) {
    const kind = cursor.value.spec.codepilotKind;
    if (typeof kind === 'string') result.push(kind);
    cursor.next();
  }
  return result;
}

const fixture = [
  '# Heading',
  '',
  'Paragraph with **bold**, $x^2$ and [link](https://example.com).',
  '',
  '![diagram](./assets/diagram.png)',
  '',
  '- [ ] Todo',
  '- [x] Done',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| A | 1 |',
  '',
  '```ts',
  'const value = 1;',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  '$$',
  'x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a}',
  '$$',
  '',
  'end',
].join('\n');

describe('production Markdown Live Preview decorations', () => {
  it('renders every Phase 2 parity block while the cursor is elsewhere', () => {
    const state = EditorState.create({
      doc: fixture,
      selection: { anchor: fixture.length },
      extensions: [markdown({ base: markdownLanguage })],
    });
    const built = buildMarkdownLivePreview(
      state,
      [{ from: 0, to: fixture.length }],
      { filename: '/workspace/docs/note.md', sessionId: 'session-1' },
    );
    const kinds = decorationKinds(built.decorations);

    for (const expected of [
      'heading-prefix',
      'emphasis-marker',
      'math-inline',
      'link-marker',
      'image',
      'task-list-prefix',
      'task-checkbox',
      'table',
      'code-block',
      'mermaid',
      'math-block',
    ]) {
      assert.ok(kinds.includes(expected), `missing ${expected}: ${kinds.join(', ')}`);
    }
    assert.ok(decorationKinds(built.atomic).includes('table'));
    assert.equal(
      kinds.filter((kind) => kind === 'task-checkbox').length,
      2,
      'unchecked and checked tasks should both render as checkbox widgets',
    );
  });

  it('reveals the entire active block as lossless source', () => {
    const tablePosition = fixture.indexOf('| Name |') + 2;
    const state = EditorState.create({
      doc: fixture,
      selection: { anchor: tablePosition },
      extensions: [markdown({ base: markdownLanguage })],
    });
    const kinds = decorationKinds(
      buildMarkdownLivePreview(state, [{ from: 0, to: fixture.length }]).decorations,
    );
    assert.equal(kinds.includes('table'), false);
    assert.ok(kinds.includes('code-block'), 'unrelated inactive blocks stay rendered');
  });

  it('limits work to half-open visible ranges', () => {
    const headingEnd = fixture.indexOf('\n');
    const state = EditorState.create({
      doc: fixture,
      selection: { anchor: fixture.length },
      extensions: [markdown({ base: markdownLanguage })],
    });
    const kinds = decorationKinds(
      buildMarkdownLivePreview(state, [{ from: 0, to: headingEnd }]).decorations,
    );
    assert.deepEqual(kinds, ['heading-prefix']);
  });
});

describe('controlled value and asset contracts', () => {
  it('applies the smallest external diff without adding an undo step', () => {
    let state = EditorState.create({ doc: 'alpha', extensions: [history()] });
    state = state.update({
      changes: { from: 5, insert: '!' },
      selection: { anchor: 6 },
    }).state;
    const sync = externalMarkdownValueSync(state, 'ALPHA!');
    assert.ok(sync);
    state = state.update(sync).state;
    assert.equal(state.doc.toString(), 'ALPHA!');
    assert.equal(state.selection.main.head, 6);

    let undone = state;
    const didUndo = undo({
      state,
      dispatch(transaction) {
        undone = transaction.state;
      },
    });
    assert.equal(didUndo, true);
    assert.equal(undone.doc.toString(), 'ALPHA');
  });

  it('resolves relative images through the session-scoped file route', () => {
    assert.equal(
      resolveMarkdownAssetUrl('../img/diagram.png', {
        filename: '/workspace/docs/note.md',
        sessionId: 'session 1',
      }),
      '/api/files/serve?path=%2Fworkspace%2Fimg%2Fdiagram.png&sessionId=session%201',
    );
    assert.equal(
      resolveMarkdownAssetUrl('https://example.com/image.png', {
        filename: '/workspace/docs/note.md',
        sessionId: 'session-1',
      }),
      'https://example.com/image.png',
    );
  });
});
