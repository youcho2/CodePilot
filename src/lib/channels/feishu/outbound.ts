/**
 * Feishu outbound message rendering and sending.
 *
 * Text messages use `post` format with `md` tag for markdown rendering.
 * Card messages (buttons, permissions) use Schema V2 interactive cards.
 *
 * Markdown is optimized for Feishu: heading demotion, table spacing,
 * code block padding, and invalid image key stripping.
 */

import type * as lark from '@larksuiteoapi/node-sdk';
import type { OutboundMessage, SendResult } from '../../bridge/types';

const LOG_TAG = '[feishu/outbound]';

// ─── Markdown optimization for Feishu ────────────────────────────────────────

/**
 * Optimize markdown for Feishu rendering compatibility.
 *
 * Based on OpenClaw's markdown-style.ts:
 * - Demote headings: H1 → H4, H2-H6 → H5 (Feishu renders H1-H3 too large)
 * - Add spacing around tables with <br> tags
 * - Pad code blocks with <br> for visual separation
 * - Strip invalid image keys (prevent CardKit error 200570)
 * - Compress excessive newlines (3+ → 2)
 */
export function optimizeMarkdown(text: string): string {
  try {
    return _optimizeMarkdown(text);
  } catch {
    return text;
  }
}

function _optimizeMarkdown(text: string): string {
  // 1. Extract code blocks — protect from transformation
  const MARK = '___CB_';
  const codeBlocks: string[] = [];
  let r = text.replace(/```[\s\S]*?```/g, (m) => {
    return `${MARK}${codeBlocks.push(m) - 1}___`;
  });

  // 2. Heading demotion (only if H1-H3 exist)
  const hasLargeHeadings = /^#{1,3} /m.test(r);
  if (hasLargeHeadings) {
    r = r.replace(/^#{2,6} (.+)$/gm, '##### $1'); // H2-H6 → H5
    r = r.replace(/^# (.+)$/gm, '#### $1');        // H1 → H4
  }

  // 3. Spacing between consecutive headings
  r = r.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, '$1\n<br>\n$2');

  // 4. Table spacing — add <br> before/after table blocks
  r = r.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2');
  r = r.replace(/\n\n((?:\|.+\|[^\S\n]*\n?)+)/g, '\n\n<br>\n\n$1');
  r = r.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, '$1\n<br>\n');

  // 5. Restore code blocks with <br> padding
  codeBlocks.forEach((block, i) => {
    r = r.replace(`${MARK}${i}___`, `\n<br>\n${block}\n<br>\n`);
  });

  // 6. Strip invalid image keys (only allow img_xxx and http(s) URLs)
  if (r.includes('![')) {
    r = r.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_full, _alt, value) => {
      if (value.startsWith('img_') || value.startsWith('http://') || value.startsWith('https://')) {
        return _full;
      }
      return value;
    });
  }

  // 7. Compress excessive newlines
  r = r.replace(/\n{3,}/g, '\n\n');

  return r;
}

/**
 * Convert HTML-formatted text (from permission-broker) to Feishu markdown.
 */
function htmlToFeishuMarkdown(text: string): string {
  return text
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre>([\s\S]*?)<\/pre>/gi, '```\n$1\n```')
    .replace(/<\/?[^>]+>/g, '');
}

// ─── Message sending ─────────────────────────────────────────────────────────

/**
 * Send a message to Feishu.
 *
 * - With inlineButtons → interactive card (Schema V2)
 * - Without → post format with md tag (supports markdown rendering)
 */
export async function sendMessage(
  client: lark.Client,
  message: OutboundMessage,
): Promise<SendResult> {
  try {
    const chatId = message.address.chatId.split(':thread:')[0];
    const replyId = message.replyToMessageId;

    // Interactive card for messages with buttons
    if (message.inlineButtons && message.inlineButtons.length > 0) {
      return sendAsInteractiveCard(client, chatId, message.text, message.inlineButtons, replyId);
    }

    // Post format with md tag for markdown support
    return sendAsPost(client, chatId, message.text, message.parseMode, replyId);
  } catch (err: any) {
    console.error(LOG_TAG, 'Send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'Unknown error' };
  }
}

/**
 * Send a message using post format with md tag.
 * This enables markdown rendering in Feishu (bold, code, lists, tables, etc).
 */
async function sendAsPost(
  client: lark.Client,
  chatId: string,
  text: string,
  parseMode?: string,
  replyToMessageId?: string,
): Promise<SendResult> {
  // Convert HTML to markdown if needed, then optimize for Feishu
  let mdText = parseMode === 'HTML' ? htmlToFeishuMarkdown(text) : text;
  mdText = optimizeMarkdown(mdText);

  const content = JSON.stringify({
    zh_cn: {
      content: [[{ tag: 'md', text: mdText }]],
    },
  });

  let resp: any;
  if (replyToMessageId) {
    resp = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: { content, msg_type: 'post' },
    });
  } else {
    resp = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, content, msg_type: 'post' },
    });
  }

  const msgId = resp?.data?.message_id || '';
  return { ok: true, messageId: msgId };
}

// ─── Interactive cards ───────────────────────────────────────────────────────

/**
 * Build and send a Feishu interactive card with buttons.
 *
 * Uses Schema V2 with:
 * - markdown element for text content
 * - action element for buttons (Allow = primary, Deny = danger)
 */
async function sendAsInteractiveCard(
  client: lark.Client,
  chatId: string,
  text: string,
  inlineButtons: import('../../bridge/types').InlineButton[][],
  replyToMessageId?: string,
): Promise<SendResult> {
  try {
    const mdText = htmlToFeishuMarkdown(text);

    // Build button columns — Schema V2 doesn't support 'action' tag,
    // use column_set with individual button elements instead
    const buttonColumns = inlineButtons.flat().map((btn) => {
      let btnType: 'primary' | 'danger' | 'default' = 'default';
      const lowerText = btn.text.toLowerCase();
      if (lowerText.includes('deny') || lowerText.includes('拒绝')) {
        btnType = 'danger';
      } else if (lowerText.includes('allow') || lowerText.includes('允许')) {
        btnType = 'primary';
      }

      return {
        tag: 'column' as const,
        width: 'auto' as const,
        elements: [
          {
            tag: 'button' as const,
            text: { tag: 'plain_text' as const, content: btn.text },
            type: btnType,
            size: 'medium' as const,
            value: { callback_data: btn.callbackData, chatId },
          },
        ],
      };
    });

    const card = {
      schema: '2.0',
      config: {
        wide_screen_mode: true,
        style: {
          color: {
            'light-orange-bg': {
              light_mode: 'rgba(255, 214, 102, 0.12)',
              dark_mode: 'rgba(255, 214, 102, 0.08)',
            },
          },
        },
      },
      header: {
        title: { tag: 'plain_text' as const, content: 'Permission Required' },
        template: 'blue' as const,
        icon: { tag: 'standard_icon' as const, token: 'lock-chat_filled' },
        padding: '12px 12px 12px 12px',
      },
      body: {
        elements: [
          {
            tag: 'markdown' as const,
            content: mdText,
            text_size: 'normal' as const,
          },
          {
            tag: 'markdown' as const,
            content: '⏱ This request will expire in 5 minutes',
            text_size: 'notation' as const,
          },
          { tag: 'hr' as const },
          {
            tag: 'column_set' as const,
            flex_mode: 'none' as const,
            horizontal_align: 'left' as const,
            columns: buttonColumns,
          },
        ],
      },
    };

    const cardContent = JSON.stringify(card);

    let resp: any;
    if (replyToMessageId) {
      resp = await client.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content: cardContent, msg_type: 'interactive' },
      });
    } else {
      resp = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, content: cardContent, msg_type: 'interactive' },
      });
    }

    const msgId = resp?.data?.message_id || '';
    console.log(LOG_TAG, 'Sent interactive card:', msgId);
    return { ok: true, messageId: msgId };
  } catch (err: any) {
    console.error(LOG_TAG, 'Interactive card send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'Unknown error' };
  }
}

// ─── Reactions ──────────────────────────────────────────────────────────────

/**
 * Add an emoji reaction to a Feishu message.
 * Used as a "message received" acknowledgment before processing starts.
 */
export async function addReaction(
  client: lark.Client,
  messageId: string,
  emojiType: string = 'OnIt',
): Promise<string | null> {
  try {
    const resp = await client.im.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emojiType } },
    });
    return (resp?.data as any)?.reaction_id || null;
  } catch (err: any) {
    // Non-critical — log and swallow
    console.warn(LOG_TAG, 'Failed to add reaction:', err?.message || err);
    return null;
  }
}

/**
 * Remove an emoji reaction from a Feishu message.
 * Used to clear the "processing" indicator after response is sent.
 */
export async function removeReaction(
  client: lark.Client,
  messageId: string,
  reactionId: string,
): Promise<void> {
  try {
    await client.im.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId },
    });
  } catch (err: any) {
    console.warn(LOG_TAG, 'Failed to remove reaction:', err?.message || err);
  }
}

/**
 * Send a pre-built card (for permission cards or custom cards).
 */
export async function sendPermissionCard(
  client: lark.Client,
  chatId: string,
  cardContent: string,
  replyToMessageId?: string,
): Promise<SendResult> {
  try {
    const realChatId = chatId.split(':thread:')[0];

    let resp: any;
    if (replyToMessageId) {
      resp = await client.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content: cardContent, msg_type: 'interactive' },
      });
    } else {
      resp = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: realChatId, content: cardContent, msg_type: 'interactive' },
      });
    }

    const msgId = resp?.data?.message_id || '';
    return { ok: true, messageId: msgId };
  } catch (err: any) {
    console.error(LOG_TAG, 'Permission card send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'Unknown error' };
  }
}
