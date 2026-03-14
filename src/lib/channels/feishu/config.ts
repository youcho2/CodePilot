/**
 * Feishu configuration loading and validation.
 */

import { getSetting } from '../../db';
import type { FeishuConfig, CardStreamConfig, BlockStreamingCoalesce, FooterConfig } from './types';

/** Parse a comma-separated string into a trimmed, non-empty string array. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/** Load Feishu config from settings DB. Returns null if incomplete. */
export function loadFeishuConfig(): FeishuConfig | null {
  const appId = getSetting('bridge_feishu_app_id');
  const appSecret = getSetting('bridge_feishu_app_secret');
  if (!appId || !appSecret) return null;

  const domain = getSetting('bridge_feishu_domain') || 'feishu';
  const encryptKey = getSetting('bridge_feishu_encrypt_key') || '';
  const verificationToken = getSetting('bridge_feishu_verification_token') || '';

  const allowFrom = parseList(getSetting('bridge_feishu_allow_from'));
  const groupAllowFrom = parseList(getSetting('bridge_feishu_group_allow_from'));
  const dmPolicy = (getSetting('bridge_feishu_dm_policy') || 'open') as FeishuConfig['dmPolicy'];
  const groupPolicy = (getSetting('bridge_feishu_group_policy') || 'open') as FeishuConfig['groupPolicy'];
  const renderMode = (getSetting('bridge_feishu_render_mode') || 'auto') as FeishuConfig['renderMode'];
  const requireMention = getSetting('bridge_feishu_require_mention') === 'true';
  const threadSession = getSetting('bridge_feishu_thread_session') === 'true';
  const blockStreaming = getSetting('bridge_feishu_block_streaming') === 'true';

  // Validation: when dmPolicy is 'open', allowFrom should include '*'
  if (dmPolicy === 'open' && allowFrom.length > 0 && !allowFrom.includes('*')) {
    allowFrom.push('*');
  }

  let cardStreamConfig: CardStreamConfig | null = null;
  if (!blockStreaming && renderMode !== 'static') {
    cardStreamConfig = {
      throttleMs: 200,
    };
  }

  let blockStreamingCoalesce: BlockStreamingCoalesce | null = null;
  if (blockStreaming) {
    blockStreamingCoalesce = {
      minChars: 20,
      maxChars: 4096,
      idleMs: 300,
    };
  }

  // Footer config
  const footerStatus = getSetting('bridge_feishu_footer_status');
  const footerElapsed = getSetting('bridge_feishu_footer_elapsed');
  let footer: FooterConfig | null = null;
  if (footerStatus !== undefined || footerElapsed !== undefined) {
    footer = {
      status: footerStatus === 'true',
      elapsed: footerElapsed === 'true',
    };
  }

  return {
    appId,
    appSecret,
    domain,
    encryptKey,
    verificationToken,
    allowFrom,
    groupAllowFrom,
    dmPolicy,
    groupPolicy,
    renderMode,
    requireMention,
    threadSession,
    cardStreamConfig,
    blockStreamingCoalesce,
    footer,
  };
}

/** Validate a Feishu config. Returns null if valid, error message otherwise. */
export function validateFeishuConfig(config: FeishuConfig | null): string | null {
  if (!config) return 'Feishu App ID and App Secret are required.';
  if (!config.appId) return 'Feishu App ID is required.';
  if (!config.appSecret) return 'Feishu App Secret is required.';
  return null;
}
