/**
 * status-notice-i18n.ts — map an SSE status notification's (code, reason) pair
 * to the i18n keys that render it.
 *
 * Why this exists (Codex review P2, 2026-07-18): SAMPLING_PARAMS_IGNORED and the
 * unsupported-model RUNTIME_EFFORT_IGNORED were emitted as server-rendered
 * English strings. The server can't know the reader's locale, so a zh user got
 * an English toast for a decision the app made on their behalf. The producers
 * now send `{ code, reason, params }` and the rendering happens here, on the
 * client, where the locale lives.
 *
 * Kept as its own dependency-free module (same convention as
 * anthropic-sampling-notice.ts) so BOTH chat entry points — useSSEStream's
 * handler and the inline SSE parser in app/chat/page.tsx — provably resolve the
 * SAME key: they both call `maybeShowStatusToast`, which calls this. A second
 * mapping table would be exactly the drift this module prevents.
 *
 * Notices without a `reason` (THINKING_ALWAYS_ON, the third-party-proxy variant
 * of RUNTIME_EFFORT_IGNORED) are NOT mapped here and keep using the server's
 * `message` field — untouched by this round's scope.
 */

import type { TranslationKey } from '@/i18n';

/** The subset of an SSE status payload this module reads. */
export interface LocalizableStatusNotice {
  code?: string;
  reason?: string;
  params?: Record<string, string | number>;
}

export interface StatusNoticeKeys {
  titleKey: TranslationKey;
  messageKey: TranslationKey;
}

/**
 * Resolve the i18n keys for a code/reason pair, or null when the notice isn't
 * localizable (no reason, or an unrecognized one — e.g. a newer server talking
 * to an older client). Callers fall back to the payload's `message`, so an
 * unmapped notice degrades to "shown in the server's language" rather than
 * "silently dropped".
 */
export function resolveStatusNoticeKeys(
  notice: LocalizableStatusNotice,
): StatusNoticeKeys | null {
  const { code, reason, params } = notice;
  if (!code || !reason) return null;

  // English pluralizes "was/were not sent"; the count rides in params so the
  // key — not the server — picks the form.
  const plural = typeof params?.count === 'number' && params.count > 1 ? 'other' : 'one';

  switch (`${code}:${reason}`) {
    case 'SAMPLING_PARAMS_IGNORED:model-rejects':
      return {
        titleKey: 'chat.notice.samplingIgnored.title',
        messageKey: `chat.notice.samplingIgnored.modelRejects.${plural}` as TranslationKey,
      };
    case 'SAMPLING_PARAMS_IGNORED:runtime-cannot-send':
      return {
        titleKey: 'chat.notice.samplingIgnored.title',
        messageKey: `chat.notice.samplingIgnored.runtimeCannotSend.${plural}` as TranslationKey,
      };
    case 'RUNTIME_EFFORT_IGNORED:unsupported-model':
      return {
        titleKey: 'chat.notice.effortIgnored.unsupportedModel.title',
        messageKey: 'chat.notice.effortIgnored.unsupportedModel.message',
      };
    default:
      return null;
  }
}
