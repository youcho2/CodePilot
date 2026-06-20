/**
 * composer-first-message-clear.test.ts — #4/#5 (v0.56.x Phase 2).
 *
 * Bug (reproduced via CDP): in the FIRST-message flow, the composer text lingers
 * in the box through the entire streaming turn ("content sent but text still
 * there"). Basic + image sends in ChatView clear fine; only the first message
 * doesn't.
 *
 * Root cause (CDP-instrumented): at send-accept page.tsx flips `isStreaming`,
 * which switches the hero→active layout branch and REMOUNTS the composer (the
 * keyed MessageInput identity doesn't survive the branch switch — instrumentation
 * showed ComposerResetSignal mounts++ with the new nonce already set, so any
 * in-component "clear on signal change" guard early-returns). The remount already
 * resets attachments / badges / directory refs; the ONE piece of composer state
 * that survives it is the persisted `sessionStorage` draft, which the remounted
 * MessageInput re-seeds `inputValue` from — so the just-sent text reappears.
 *
 * Fix: page.tsx clears the draft (`composerDraftKey()`) at accept, so the
 * remounted composer comes up empty. Source-pins (React-coupled).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

describe('first-message composer clears at accept (#4/#5)', () => {
  it('MessageInput exports composerDraftKey and uses it for its draft bucket', () => {
    const src = read('components/chat/MessageInput.tsx');
    assert.match(
      src,
      /export const composerDraftKey = \(sessionId\?: string\): string =>\s*`codepilot:draft:\$\{sessionId \|\| 'new'\}`/,
      'composerDraftKey must be the single source of the draft sessionStorage key',
    );
    assert.match(
      src,
      /const draftKey = composerDraftKey\(sessionId\)/,
      'MessageInput must derive its draftKey from composerDraftKey (no re-hardcoded format)',
    );
  });

  it('page.tsx clears the persisted draft at accept (so the remounted composer is empty)', () => {
    const src = read('app/chat/page.tsx');
    assert.match(src, /import \{ MessageInput, composerDraftKey \} from '@\/components\/chat\/MessageInput'/);
    // the clear must sit right at/after `accepted = true` (the committed point),
    // BEFORE the stream loop / redirect — clearing late is the original bug.
    assert.match(
      src,
      /accepted = true;[\s\S]{0,600}sessionStorage\.removeItem\(composerDraftKey\(\)\)/,
      'the draft must be cleared immediately after accepted = true',
    );
  });

  it('the defeated ComposerResetSignal nonce mechanism is gone', () => {
    // It could never fire — the accept-time remount re-initialised its
    // last-seen-nonce ref to the new value (CDP: fires=0). Guard against it
    // being reintroduced as a "fix" that silently does nothing.
    const partsSrc = read('components/chat/MessageInputParts.tsx');
    assert.doesNotMatch(partsSrc, /ComposerResetSignal/);
    const pageSrc = read('app/chat/page.tsx');
    assert.doesNotMatch(pageSrc, /composerResetNonce|resetSignal=/);
  });
});
