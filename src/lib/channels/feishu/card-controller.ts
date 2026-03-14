/**
 * CodePilot Simplified Card Streaming
 *
 * Manages streaming card lifecycle via CardKit v2 API.
 * State machine: idle → creating → streaming → completed | error
 *
 * Differences from OpenClaw's StreamingCardController:
 * - No reasoning phase streaming (thinking indicator)
 * - No FlushController / UnavailableGuard
 * - No IM patch fallback (if CardKit fails, falls back to static text)
 * - No reply boundary detection
 * - Footer is simplified (just elapsed time and status text, no animated status)
 *
 * These are intentional simplifications for CodePilot's use case.
 */

import type * as lark from '@larksuiteoapi/node-sdk';
import type { CardStreamController } from '../types';
import type { CardStreamConfig } from './types';

const LOG_TAG = '[card-controller]';

interface CardState {
  cardId: string;
  messageId: string;
  sequence: number;
  lastUpdateAt: number;
  startTime: number;
  throttleTimer: ReturnType<typeof setTimeout> | null;
  pendingText: string | null;
}

class FeishuCardStreamController implements CardStreamController {
  private client: lark.Client;
  private config: CardStreamConfig;
  private cards = new Map<string, CardState>();

  constructor(client: lark.Client, config: CardStreamConfig) {
    this.client = client;
    this.config = config;
  }

  async create(chatId: string, initialText: string, replyToMessageId?: string): Promise<string> {
    try {
      // 1. Create streaming card via CardKit v2
      const cardBody = {
        schema: '2.0',
        config: { streaming_mode: true, wide_screen_mode: true },
        body: {
          elements: [{
            tag: 'markdown',
            content: initialText || '...',
            element_id: 'streaming_content',
          }],
        },
      };

      const createResp = await (this.client as any).cardkit.v2.card.create({
        data: { type: 'card_json', data: JSON.stringify(cardBody) },
      });
      const cardId = createResp?.data?.card_id;
      if (!cardId) {
        console.error(LOG_TAG, 'Card create returned no card_id');
        return '';
      }
      console.log(LOG_TAG, 'Created card:', cardId);

      // 2. Send card as IM message
      const cardContent = JSON.stringify({ type: 'card', data: { card_id: cardId } });
      let msgResp: any;
      if (replyToMessageId) {
        msgResp = await this.client.im.message.reply({
          path: { message_id: replyToMessageId },
          data: { content: cardContent, msg_type: 'interactive' },
        });
      } else {
        msgResp = await this.client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, content: cardContent, msg_type: 'interactive' },
        });
      }
      const messageId = msgResp?.data?.message_id || '';
      console.log(LOG_TAG, 'Sent card message:', messageId);

      this.cards.set(messageId, {
        cardId,
        messageId,
        sequence: 0,
        lastUpdateAt: Date.now(),
        startTime: Date.now(),
        throttleTimer: null,
        pendingText: null,
      });

      return messageId;
    } catch (err: any) {
      console.error(LOG_TAG, 'Card create failed:', err?.message || err);
      return '';
    }
  }

  async update(messageId: string, text: string): Promise<'ok' | 'fail'> {
    const state = this.cards.get(messageId);
    if (!state) return 'fail';

    state.pendingText = text;

    const elapsed = Date.now() - state.lastUpdateAt;
    if (elapsed < this.config.throttleMs) {
      // Schedule trailing-edge flush
      if (!state.throttleTimer) {
        state.throttleTimer = setTimeout(() => {
          state.throttleTimer = null;
          if (state.pendingText) {
            this.flushUpdate(state).catch(() => {});
          }
        }, this.config.throttleMs - elapsed);
      }
      return 'ok';
    }

    return this.flushUpdate(state);
  }

  private async flushUpdate(state: CardState): Promise<'ok' | 'fail'> {
    if (!state.pendingText) return 'ok';
    const text = state.pendingText;
    state.pendingText = null;

    try {
      state.sequence++;
      await (this.client as any).cardkit.v2.card.streamContent({
        path: { card_id: state.cardId },
        data: { content: text, sequence: state.sequence },
      });
      state.lastUpdateAt = Date.now();
      return 'ok';
    } catch (err: any) {
      console.error(LOG_TAG, 'Stream update failed:', err?.message || err);
      return 'fail';
    }
  }

  async finalize(
    messageId: string,
    finalText: string,
    status: 'completed' | 'interrupted' | 'error' = 'completed',
  ): Promise<void> {
    const state = this.cards.get(messageId);
    if (!state) return;

    // Clear any pending throttle
    if (state.throttleTimer) {
      clearTimeout(state.throttleTimer);
      state.throttleTimer = null;
    }

    try {
      // Close streaming mode
      await (this.client as any).cardkit.v2.card.setStreamingMode({
        path: { card_id: state.cardId },
        params: { streaming_mode: false },
      });

      // Build footer elements if configured
      const footerElements: Array<{ tag: string; content: string; element_id: string }> = [];
      const footerCfg = this.config.footer;

      if (footerCfg?.elapsed) {
        const elapsedMs = Date.now() - state.startTime;
        const elapsedSec = (elapsedMs / 1000).toFixed(1);
        footerElements.push({
          tag: 'markdown',
          content: `*${elapsedSec}s*`,
          element_id: 'footer_elapsed',
        });
      }

      if (footerCfg?.status) {
        const statusLabels: Record<string, string> = {
          completed: 'Completed',
          interrupted: 'Interrupted',
          error: 'Error',
        };
        footerElements.push({
          tag: 'markdown',
          content: `**${statusLabels[status] || status}**`,
          element_id: 'footer_status',
        });
      }

      // Update final card content
      const finalCard = {
        schema: '2.0',
        config: { wide_screen_mode: true },
        body: {
          elements: [
            {
              tag: 'markdown',
              content: finalText,
              element_id: 'streaming_content',
            },
            ...footerElements,
          ],
        },
      };
      await (this.client as any).cardkit.v2.card.update({
        path: { card_id: state.cardId },
        data: { type: 'card_json', data: JSON.stringify(finalCard) },
      });
    } catch (err: any) {
      console.error(LOG_TAG, 'Finalize failed:', err?.message || err);
    }

    console.log(LOG_TAG, `Finalized card ${state.cardId} as ${status}`);
    this.cards.delete(messageId);
  }
}

/**
 * Factory function for creating a card stream controller.
 */
export function createCardStreamController(
  client: lark.Client,
  config: CardStreamConfig,
): CardStreamController {
  return new FeishuCardStreamController(client, config);
}
