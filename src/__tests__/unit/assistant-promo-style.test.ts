import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../../components/chat/ChatEmptyState.tsx'),
  'utf8',
);
const promoSource = source.slice(source.indexOf('export function AssistantPromoCard'));

describe('assistant sidebar promo style contract', () => {
  it('uses the compact sidebar surface instead of the content Card treatment', () => {
    assert.match(promoSource, /rounded-xl border border-sidebar-border\/60 bg-sidebar-accent\/40/);
    assert.match(promoSource, /variant="ghost"/);
    assert.doesNotMatch(promoSource, /<Card(?:\s|>)/);
    assert.doesNotMatch(promoSource, /variant="outline"/);
  });

  it('keeps the dismiss action localized and large enough to target', () => {
    assert.match(promoSource, /aria-label=\{t\('chat\.empty\.assistant\.dismiss'\)\}/);
    assert.match(promoSource, /size-6/);
  });
});
