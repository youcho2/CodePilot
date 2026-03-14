/**
 * Feishu outbound message rendering and sending.
 *
 * Missing capabilities compared to OpenClaw's ChannelMessageActionAdapter:
 * - No react/unreact support (add/remove emoji reactions)
 * - No message delete/unsend support
 * - No user identity (user_access_token) sending — bot identity only
 */

import type * as lark from '@larksuiteoapi/node-sdk';
import type { OutboundMessage, SendResult } from '../../bridge/types';

const LOG_TAG = '[feishu/outbound]';

/**
 * Send a message to Feishu using bot identity (app_access_token).
 *
 * If the message contains inlineButtons, it is rendered as an interactive card
 * (Schema V2 with column_set + button layout). Otherwise it's sent as plain text.
 *
 * OpenClaw supports both bot and user identity via its ChannelMessageActionAdapter,
 * allowing messages to be sent as the authenticated user when user_access_token is available.
 *
 * This handles static message delivery — card streaming is handled upstream by bridge-manager.
 */
export async function sendMessage(
  client: lark.Client,
  message: OutboundMessage,
): Promise<SendResult> {
  try {
    // Extract real chat ID (strip thread prefix if present)
    const chatId = message.address.chatId.split(':thread:')[0];
    const replyId = message.replyToMessageId;

    // If message has inline buttons, send as interactive card
    if (message.inlineButtons && message.inlineButtons.length > 0) {
      return sendAsInteractiveCard(client, chatId, message.text, message.inlineButtons, replyId);
    }

    const content = JSON.stringify({ text: message.text });

    let resp: any;
    if (replyId) {
      resp = await client.im.message.reply({
        path: { message_id: replyId },
        data: {
          content,
          msg_type: 'text',
        },
      });
    } else {
      resp = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content,
          msg_type: 'text',
        },
      });
    }

    const msgId = resp?.data?.message_id || '';
    return { ok: true, messageId: msgId };
  } catch (err: any) {
    console.error(LOG_TAG, 'Send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'Unknown error' };
  }
}

/**
 * Build and send a Feishu interactive card with buttons.
 *
 * Uses Schema V2 with column_set + column + button layout because
 * Schema V2 does NOT support the `action` tag directly.
 */
async function sendAsInteractiveCard(
  client: lark.Client,
  chatId: string,
  text: string,
  inlineButtons: import('../../bridge/types').InlineButton[][],
  replyToMessageId?: string,
): Promise<SendResult> {
  try {
    // Strip HTML tags for Feishu (convert <b> to **, <code> to `, <pre> to ```)
    const mdText = text
      .replace(/<b>(.*?)<\/b>/gi, '**$1**')
      .replace(/<code>(.*?)<\/code>/gi, '`$1`')
      .replace(/<pre>([\s\S]*?)<\/pre>/gi, '```\n$1\n```')
      .replace(/<\/?[^>]+>/g, '');

    // Build button elements using column_set layout (Schema V2 compatible)
    const buttonRows = inlineButtons.map((row) => ({
      tag: 'column_set' as const,
      flex_mode: 'stretch' as const,
      columns: row.map((btn) => ({
        tag: 'column' as const,
        width: 'weighted' as const,
        weight: 1,
        elements: [{
          tag: 'button' as const,
          text: { tag: 'plain_text' as const, content: btn.text },
          type: 'primary' as const,
          value: { callback_data: btn.callbackData, chatId },
        }],
      })),
    }));

    const card = {
      schema: '2.0',
      config: { wide_screen_mode: true },
      body: {
        elements: [
          { tag: 'markdown', content: mdText },
          ...buttonRows,
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

/**
 * Send a permission card with interactive buttons using bot identity (app_access_token).
 *
 * OpenClaw supports both bot and user identity for card delivery.
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
        data: {
          content: cardContent,
          msg_type: 'interactive',
        },
      });
    } else {
      resp = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: realChatId,
          content: cardContent,
          msg_type: 'interactive',
        },
      });
    }

    const msgId = resp?.data?.message_id || '';
    return { ok: true, messageId: msgId };
  } catch (err: any) {
    console.error(LOG_TAG, 'Permission card send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'Unknown error' };
  }
}
