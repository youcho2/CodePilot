/**
 * RC-5: chat and file preview must share one neutral Markdown contract.
 *
 * Chat may override interactive chrome for tables/code, but typography and
 * structural elements must be the exact same component identities.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CHAT_MARKDOWN_COMPONENTS } from '../../components/chat/markdown-components';
import { DevOutputMarkdownLink } from '../../components/chat/DevOutputChips';
import {
  BASE_MARKDOWN_COMPONENTS,
  MARKDOWN_LINK_CLASS_NAME,
  PREVIEW_MARKDOWN_COMPONENTS,
} from '../../components/markdown/markdown-contract';

const sharedKeys = [
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'a',
  'strong',
  'img',
  'thead',
  'tbody',
  'pre',
] as const;

describe('CodePilot Markdown component contract', () => {
  it('uses the neutral contract directly in file previews', () => {
    assert.equal(PREVIEW_MARKDOWN_COMPONENTS, BASE_MARKDOWN_COMPONENTS);
  });

  it('keeps chat and preview typography/structure on identical components', () => {
    for (const key of sharedKeys) {
      assert.equal(
        CHAT_MARKDOWN_COMPONENTS[key],
        PREVIEW_MARKDOWN_COMPONENTS[key],
        `${key} should not fork between chat and preview`,
      );
    }
  });

  it('renders the representative typography fixture with CodePilot classes', () => {
    const h1 = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.h1, null, 'Heading'),
    );
    const paragraph = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.p, null, 'Paragraph'),
    );
    const quote = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.blockquote, null, 'Quote'),
    );
    const link = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.a, { href: 'https://example.com' }, 'Link'),
    );
    const inlineCode = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.code, null, 'const x = 1'),
    );

    assert.match(h1, /text-2xl/);
    assert.match(paragraph, /leading-7/);
    assert.match(quote, /border-l-4/);
    assert.match(link, /target="_blank"/);
    assert.match(link, /text-blue-600/);
    assert.match(link, /dark:text-blue-400/);
    assert.match(inlineCode, /font-mono/);
  });

  it('keeps links visibly blue while preserving caller classes', () => {
    const link = renderToStaticMarkup(
      createElement(
        PREVIEW_MARKDOWN_COMPONENTS.a,
        { href: 'README.md', className: 'caller-link-class' },
        'Local file',
      ),
    );

    assert.match(MARKDOWN_LINK_CLASS_NAME, /text-blue-600/);
    assert.match(MARKDOWN_LINK_CLASS_NAME, /hover:text-blue-700/);
    assert.match(MARKDOWN_LINK_CLASS_NAME, /focus-visible:ring-2/);
    assert.match(link, /text-blue-600/);
    assert.match(link, /caller-link-class/);
  });

  it('uses the same blue contract for Codex remote and local links', () => {
    const remoteLink = renderToStaticMarkup(
      createElement(DevOutputMarkdownLink, { href: 'https://example.com' }, 'Remote'),
    );
    const localLink = renderToStaticMarkup(
      createElement(DevOutputMarkdownLink, { href: '/tmp/example.md' }, 'Local'),
    );

    assert.match(remoteLink, /text-blue-600/);
    assert.match(remoteLink, /target="_blank"/);
    assert.match(localLink, /text-blue-600/);
    assert.match(localLink, /data-codepilot-fileref-path="\/tmp\/example.md"/);
  });
});
