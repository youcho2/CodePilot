/**
 * Channel Router — resolves IM addresses to CodePilot sessions.
 *
 * When a message arrives from an IM channel, the router finds or creates
 * the corresponding ChannelBinding (and underlying chat_session).
 */

import fs from 'fs';
import type { ChannelAddress, ChannelBinding, ChannelType } from './types';
import {
  getChannelBinding,
  upsertChannelBinding,
  updateChannelBinding,
  listChannelBindings,
  getSession,
  createSession,
  getSetting,
  updateSessionProviderId,
  updateSessionWorkingDirectory,
  updateSdkSessionId,
} from '../db';

/**
 * Resolve the first existing directory from a list of candidates.
 */
function resolveValidCwd(...candidates: (string | undefined | null)[]): string {
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir;
  }
  return process.env.HOME || '';
}

/**
 * Resolve an inbound address to a ChannelBinding.
 * If no binding exists, auto-creates a new session and binding.
 * Self-heals stale workingDirectory / sdkSessionId in existing bindings.
 */
export function resolve(address: ChannelAddress): ChannelBinding {
  const existing = getChannelBinding(address.channelType, address.chatId);
  if (existing) {
    const session = getSession(existing.codepilotSessionId);
    if (!session) {
      // Session was deleted — recreate
      return createBinding(address);
    }

    // Self-heal: validate workingDirectory and fix stale state
    const currentCwd = existing.workingDirectory;
    if (currentCwd && !fs.existsSync(currentCwd)) {
      const validCwd = resolveValidCwd(
        session.working_directory,
        getSetting('bridge_default_work_dir'),
      );
      console.log(`[channel-router] Self-healing stale cwd "${currentCwd}" → "${validCwd}" for binding ${existing.id}`);

      // Update binding
      updateChannelBinding(existing.id, {
        workingDirectory: validCwd,
        sdkSessionId: '', // Clear resume — old session context is invalid
      });

      // Update session
      updateSessionWorkingDirectory(existing.codepilotSessionId, validCwd);
      updateSdkSessionId(existing.codepilotSessionId, '');

      return {
        ...existing,
        workingDirectory: validCwd,
        sdkSessionId: '',
      };
    }

    return existing;
  }
  return createBinding(address);
}

/**
 * Create a new binding with a fresh CodePilot session.
 */
export function createBinding(
  address: ChannelAddress,
  workingDirectory?: string,
): ChannelBinding {
  const defaultCwd = workingDirectory
    || getSetting('bridge_default_work_dir')
    || process.env.HOME
    || '';
  const defaultModel = getSetting('bridge_default_model') || '';
  const defaultProviderId = getSetting('bridge_default_provider_id') || '';

  const displayName = address.displayName || address.chatId;
  const session = createSession(
    `Bridge: ${displayName}`,
    defaultModel,
    undefined,
    defaultCwd,
    'code',
  );

  if (defaultProviderId) {
    updateSessionProviderId(session.id, defaultProviderId);
  }

  return upsertChannelBinding({
    channelType: address.channelType,
    chatId: address.chatId,
    codepilotSessionId: session.id,
    sdkSessionId: '',
    workingDirectory: defaultCwd,
    model: defaultModel,
    mode: 'code',
  });
}

/**
 * Bind an IM chat to an existing CodePilot session.
 */
export function bindToSession(
  address: ChannelAddress,
  codepilotSessionId: string,
): ChannelBinding | null {
  const session = getSession(codepilotSessionId);
  if (!session) return null;

  return upsertChannelBinding({
    channelType: address.channelType,
    chatId: address.chatId,
    codepilotSessionId,
    sdkSessionId: '',
    workingDirectory: session.working_directory,
    model: session.model,
    mode: 'code',
  });
}

/**
 * Update properties of an existing binding.
 */
export function updateBinding(
  id: string,
  updates: Partial<Pick<ChannelBinding, 'sdkSessionId' | 'workingDirectory' | 'model' | 'mode' | 'active'>>,
): void {
  updateChannelBinding(id, updates);
}

/**
 * List all bindings, optionally filtered by channel type.
 */
export function listBindings(channelType?: ChannelType): ChannelBinding[] {
  return listChannelBindings(channelType);
}
