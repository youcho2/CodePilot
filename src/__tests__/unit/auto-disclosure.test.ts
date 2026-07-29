import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveAutoDisclosure,
  type AutoDisclosureOverride,
} from '../../lib/auto-disclosure';

describe('auto disclosure lifecycle', () => {
  it('opens active work and closes settled work by default', () => {
    assert.equal(resolveAutoDisclosure('active', null), true);
    assert.equal(resolveAutoDisclosure('settled', null), false);
  });

  it('respects a manual choice within the current phase', () => {
    const collapsedWhileActive: AutoDisclosureOverride = {
      phase: 'active',
      expanded: false,
    };
    const expandedWhileSettled: AutoDisclosureOverride = {
      phase: 'settled',
      expanded: true,
    };

    assert.equal(resolveAutoDisclosure('active', collapsedWhileActive), false);
    assert.equal(resolveAutoDisclosure('settled', expandedWhileSettled), true);
  });

  it('discards the prior-phase override when execution changes state', () => {
    const openedWhileActive: AutoDisclosureOverride = {
      phase: 'active',
      expanded: true,
    };
    const openedWhileSettled: AutoDisclosureOverride = {
      phase: 'settled',
      expanded: true,
    };

    // Completion closes even if the user had the running detail open.
    assert.equal(resolveAutoDisclosure('settled', openedWhileActive), false);
    // A new execution opens even if the completed detail had been opened.
    assert.equal(resolveAutoDisclosure('active', openedWhileSettled), true);
  });

  it('is wired to both the individual CLI detail and the enclosing tool group', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../components/ai-elements/tool-actions-group.tsx'),
      'utf8',
    );

    assert.match(
      source,
      /detailPhase:[^=]+=[^;]+status === 'running' \? 'active' : 'settled'/,
    );
    assert.match(
      source,
      /canShowDetail && detailExpanded && renderer\.renderDetail/,
    );
    assert.match(
      source,
      /groupPhase:[^=]+=[^;]+hasRunningTool \|\| isStreaming \? 'active' : 'settled'/,
    );
  });
});
