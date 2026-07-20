/**
 * status-notice-i18n.test.ts — the告知链 for runtime status notices renders from
 * the i18n dictionary, in the user's locale (model plan Phase 2 / s09, Codex
 * review P2 2026-07-18).
 *
 * The finding: SAMPLING_PARAMS_IGNORED and the unsupported-model
 * RUNTIME_EFFORT_IGNORED were built as English sentences on the SERVER, so a zh
 * user got English toasts and `src/i18n/*.ts` had no keys for either. These
 * tests assert the real chain end to end:
 *   producer → { code, reason, params } → resolveStatusNoticeKeys → translate
 * plus that BOTH chat entry points route through the one shared resolver (a
 * second mapping table is exactly the drift this design prevents).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStatusNoticeKeys } from '../../lib/status-notice-i18n';
import { buildSamplingIgnoredNotice } from '../../lib/anthropic-sampling-notice';
import { sanitizeClaudeModelOptions } from '../../lib/claude-model-options';
import { translate } from '../../i18n';
import en from '../../i18n/en';
import zh from '../../i18n/zh';

const readSrc = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

// The exact keys this round introduces. en/zh must both define all of them.
const NEW_KEYS = [
  'chat.notice.samplingIgnored.title',
  'chat.notice.samplingIgnored.modelRejects.one',
  'chat.notice.samplingIgnored.modelRejects.other',
  'chat.notice.samplingIgnored.runtimeCannotSend.one',
  'chat.notice.samplingIgnored.runtimeCannotSend.other',
  'chat.notice.effortIgnored.unsupportedModel.title',
  'chat.notice.effortIgnored.unsupportedModel.message',
] as const;

describe('s09 — new user-visible notices exist in BOTH locales', () => {
  for (const key of NEW_KEYS) {
    it(`${key} is defined in en and zh`, () => {
      assert.ok((en as Record<string, string>)[key], `en.ts is missing ${key}`);
      assert.ok((zh as Record<string, string>)[key], `zh.ts is missing ${key}`);
    });
  }

  it('the zh copy is actually Chinese, not an English placeholder', () => {
    for (const key of NEW_KEYS) {
      assert.match((zh as Record<string, string>)[key], /[一-龥]/,
        `${key} was copied from en.ts without translating`);
    }
  });
});

describe('s09 — sampling notice resolves to a localized string, not wire prose', () => {
  const notice = buildSamplingIgnoredNotice({
    runtime: 'native',
    model: 'claude-sonnet-5',
    sanitized: sanitizeClaudeModelOptions({ model: 'claude-sonnet-5', temperature: 0.7 }),
  })!;

  it('the producer emits a reason + params (no rendered sentence)', () => {
    assert.equal(notice.reason, 'model-rejects');
    assert.deepEqual(notice.params, { model: 'claude-sonnet-5', names: 'temperature', count: 1 });
  });

  it('renders through the i18n key in en, interpolating model + names', () => {
    const keys = resolveStatusNoticeKeys(notice)!;
    assert.equal(keys.messageKey, 'chat.notice.samplingIgnored.modelRejects.one');
    const text = translate('en', keys.messageKey, notice.params);
    assert.match(text, /claude-sonnet-5/);
    assert.match(text, /temperature/);
    assert.match(text, /was not sent/, 'single param → singular copy');
  });

  it('the SAME payload renders in Chinese for a zh user', () => {
    const keys = resolveStatusNoticeKeys(notice)!;
    const text = translate('zh', keys.messageKey, notice.params);
    assert.match(text, /[一-龥]/, 'this is the whole point of the finding');
    assert.match(text, /claude-sonnet-5/, 'the model still has to be nameable');
    assert.notEqual(text, translate('en', keys.messageKey, notice.params));
  });

  it('three stripped params pick the plural key', () => {
    const many = buildSamplingIgnoredNotice({
      runtime: 'native',
      model: 'claude-sonnet-5',
      sanitized: sanitizeClaudeModelOptions({
        model: 'claude-sonnet-5', temperature: 0.2, topP: 0.9, topK: 40,
      }),
    })!;
    const keys = resolveStatusNoticeKeys(many)!;
    assert.equal(keys.messageKey, 'chat.notice.samplingIgnored.modelRejects.other');
    assert.match(translate('en', keys.messageKey, many.params), /were not sent/);
  });

  it('the SDK runtime maps to its own reason (different failure, different copy)', () => {
    const sdk = buildSamplingIgnoredNotice({
      runtime: 'sdk',
      model: 'claude-sonnet-4-6',
      sanitized: sanitizeClaudeModelOptions({ model: 'claude-sonnet-4-6', temperature: 0.3 }),
    })!;
    const keys = resolveStatusNoticeKeys(sdk)!;
    assert.equal(keys.messageKey, 'chat.notice.samplingIgnored.runtimeCannotSend.one');
    assert.match(translate('zh', keys.messageKey, sdk.params), /SDK/);
  });
});

describe('s09 — unsupported-model effort notice is localized too', () => {
  const payload = {
    code: 'RUNTIME_EFFORT_IGNORED',
    reason: 'unsupported-model',
    params: { model: 'claude-haiku-4-5-20251001', effort: 'max' },
  };

  it('resolves to the effortIgnored keys and names model + picked effort', () => {
    const keys = resolveStatusNoticeKeys(payload)!;
    assert.equal(keys.messageKey, 'chat.notice.effortIgnored.unsupportedModel.message');
    const text = translate('en', keys.messageKey, payload.params);
    assert.match(text, /claude-haiku-4-5-20251001/);
    assert.match(text, /"max"/, 'the user must see which pick was dropped');
  });

  it('renders in Chinese for a zh user', () => {
    const keys = resolveStatusNoticeKeys(payload)!;
    const text = translate('zh', keys.messageKey, payload.params);
    assert.match(text, /[一-龥]/);
    assert.match(text, /max/);
  });

  it('the copy no longer claims Sonnet 4.6 lacks effort (P1 consistency)', () => {
    for (const locale of ['en', 'zh'] as const) {
      const text = translate(locale, 'chat.notice.effortIgnored.unsupportedModel.message', payload.params);
      assert.match(text, /Sonnet 4\.6/,
        'Sonnet 4.6 is effort-capable — the "pick a supported model" list must say so');
    }
  });
});

describe('s09 — unmapped notices degrade, they do not break', () => {
  it('a notice with no reason returns null (caller falls back to message)', () => {
    assert.equal(resolveStatusNoticeKeys({ code: 'THINKING_ALWAYS_ON' }), null);
  });

  it('an unrecognized reason returns null instead of throwing', () => {
    assert.equal(
      resolveStatusNoticeKeys({ code: 'RUNTIME_EFFORT_IGNORED', reason: 'from-a-newer-server' }),
      null,
    );
  });

  it('the third-party-proxy variant is untouched by this round', () => {
    // Still server-rendered; deliberately out of the fix scope. Documented so a
    // future reader doesn't mistake it for an oversight.
    assert.equal(resolveStatusNoticeKeys({ code: 'RUNTIME_EFFORT_IGNORED', reason: 'proxy' }), null);
  });
});

describe('s09 — both chat entry points render via the shared resolver', () => {
  it('useSSEStream localizes inside maybeShowStatusToast', () => {
    const src = readSrc('hooks/useSSEStream.ts');
    assert.match(src, /resolveStatusNoticeKeys/,
      'the toast route must resolve i18n keys, not print the wire message');
    assert.match(src, /translateActive/);
    // The status bar has to use the same resolution or it would show nothing
    // now that the server stopped sending `message` for these codes.
    assert.match(src, /callbacks\.onStatus\(resolveStatusNoticeText\(statusData\)\)/);
  });

  it('the inline parser in app/chat/page.tsx reuses maybeShowStatusToast', () => {
    const src = readSrc('app/chat/page.tsx');
    assert.match(src, /maybeShowStatusToast\(statusData\)/,
      'a second toast path would need a second mapping table — that is the drift');
    assert.doesNotMatch(src, /resolveStatusNoticeKeys/,
      'the page must NOT map keys itself; one resolver, one set of keys');
  });

  it('neither native producer emits English prose for the two localized codes', () => {
    for (const rel of ['lib/agent-loop.ts', 'lib/experimental/agent-loop-toolloop-poc.ts']) {
      const src = readSrc(rel);
      const block = src.slice(src.indexOf("wire.effortDroppedUnsupportedModel"));
      const emit = block.slice(0, block.indexOf('}));'));
      assert.match(emit, /reason: 'unsupported-model'/, `${rel} must send the reason`);
      assert.doesNotMatch(emit, /doesn't support the effort parameter/,
        `${rel} still hardcodes the English sentence`);
    }
  });

  it('the server keeps a diagnostic breadcrumb (log ≠ user surface)', () => {
    const src = readSrc('lib/agent-loop.ts');
    assert.match(src, /console\.warn\([\s\S]{0,200}not on Anthropic's effort-capable model list/,
      'dropping the toast prose must not drop operator diagnosability');
  });
});
