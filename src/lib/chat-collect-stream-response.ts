// Server-side SSE collection + assistant persistence for POST /api/chat.
//
// Extracted out of `route.ts` (Session ownership rework): Next App Router only
// allows a route module to export HTTP methods / segment config, so a named
// `collectStreamResponse` export from `route.ts` breaks `.next/types` route
// typecheck. This library module is imported by BOTH `route.ts` (production
// call site) and `collect-owner-gate.test.ts` (real-driven owner-gate test),
// keeping the route module's export surface clean.
import { isSessionStateResultError } from '@/lib/error-classifier';
import {
  addMessage,
  getSession,
  getSetting,
  updateSdkSessionId,
  updateSessionModel,
  syncSdkTasks,
  isLockOwner,
} from '@/lib/db';
import { notifySessionComplete, notifySessionError } from '@/lib/telegram-bot';
import { extractCompletion } from '@/lib/onboarding-completion';
import { saveMediaToLibrary } from '@/lib/media-saver';
import type { SSEEvent, TokenUsage, MessageContentBlock, MediaBlock } from '@/types';

/**
 * Consume the runtime SSE stream server-side and persist the assistant turn.
 *
 * Session ownership (I1/DP1 ownership gate): `lockId` is this turn's
 * session-lock owner token (minted at route.ts :85). EVERY session-level write
 * below — sdk_session_id / model / SDK tasks / the assistant `addMessage` — is
 * gated on `isLockOwner(sessionId, lockId)`. A superseded turn (its lock taken
 * over by a newer send after Stop→watchdog release) reaches here LATE and must
 * NOT write: its writes would clobber the new owner's state and (DP1) splice its
 * stale assistant output into the new owner's message timeline (the 1.9 ordering
 * bug). The happy path is safe because `addMessage` runs inside the try, BEFORE
 * `onComplete`→settleLock releases the lock (route.ts finally), so the true
 * owner is still the lock holder when it persists.
 *
 * Lives in a library module (not route.ts) so it can be imported by both the
 * route and the owner-gate behavioral test (collect-owner-gate.test.ts), which
 * drives it with a real SSE stream + real DB lock state.
 */
export async function collectStreamResponse(
  stream: ReadableStream<string>,
  sessionId: string,
  lockId: string,
  telegramOpts: { sessionId?: string; sessionTitle?: string; workingDirectory?: string },
  onComplete?: () => void,
  opts?: { isHeartbeatTurn?: boolean; suppressNotifications?: boolean },
) {
  const reader = stream.getReader();
  const contentBlocks: MessageContentBlock[] = [];
  let currentText = '';
  let thinkingText = '';
  /** Tracks whether non-thinking content arrived since last thinking delta (for phase separation) */
  let thinkingPhaseEnded = false;
  let tokenUsage: TokenUsage | null = null;
  let hasError = false;
  let errorMessage = '';
  let lastSavedAssistantMsgId: string | null = null;
  // Dedup layer: skip duplicate tool_result events by tool_use_id
  const seenToolResultIds = new Set<string>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = value.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event: SSEEvent = JSON.parse(line.slice(6));
            if (event.type === 'permission_request' || event.type === 'tool_output') {
              // Skip permission_request and tool_output events - not saved as message content
            } else if (event.type === 'thinking') {
              // Accumulate thinking content with phase separation (--- between phases)
              if (thinkingPhaseEnded) {
                if (thinkingText) thinkingText += '\n\n---\n\n';
                thinkingPhaseEnded = false;
              }
              thinkingText += event.data;
            } else if (event.type === 'text') {
              currentText += event.data;
              if (thinkingText) thinkingPhaseEnded = true;
            } else if (event.type === 'tool_use') {
              if (thinkingText) thinkingPhaseEnded = true;
              // Flush any accumulated text before the tool use block
              if (currentText.trim()) {
                contentBlocks.push({ type: 'text', text: currentText });
                currentText = '';
              }
              try {
                const toolData = JSON.parse(event.data);
                contentBlocks.push({
                  type: 'tool_use',
                  id: toolData.id,
                  name: toolData.name,
                  input: toolData.input,
                });
              } catch {
                // skip malformed tool_use data
              }
            } else if (event.type === 'tool_result') {
              try {
                const resultData = JSON.parse(event.data);

                // Save media blocks to library, replace base64 with local paths
                let savedMedia: MediaBlock[] | undefined;
                if (Array.isArray(resultData.media) && resultData.media.length > 0) {
                  savedMedia = [];
                  for (const block of resultData.media as MediaBlock[]) {
                    if (block.data) {
                      try {
                        const saved = saveMediaToLibrary(block, { sessionId });
                        savedMedia.push({
                          type: block.type,
                          mimeType: block.mimeType,
                          localPath: saved.localPath,
                          mediaId: saved.mediaId,
                        });
                      } catch (saveErr) {
                        console.warn('[chat/route] Failed to save media block:', saveErr);
                        savedMedia.push(block); // Keep original if save fails
                      }
                    } else {
                      savedMedia.push(block);
                    }
                  }
                }

                const newBlock: MessageContentBlock = {
                  type: 'tool_result' as const,
                  tool_use_id: resultData.tool_use_id,
                  content: resultData.content,
                  is_error: resultData.is_error || false,
                  ...(savedMedia && savedMedia.length > 0 ? { media: savedMedia } : {}),
                };
                // Last-wins: if same tool_use_id already exists, replace it
                // (user handler's result may be more complete than PostToolUse's)
                if (seenToolResultIds.has(resultData.tool_use_id)) {
                  const idx = contentBlocks.findIndex(
                    (b) => b.type === 'tool_result' && 'tool_use_id' in b && b.tool_use_id === resultData.tool_use_id
                  );
                  if (idx >= 0) {
                    contentBlocks[idx] = newBlock;
                  }
                } else {
                  seenToolResultIds.add(resultData.tool_use_id);
                  contentBlocks.push(newBlock);
                }
              } catch {
                // skip malformed tool_result data
              }
            } else if (event.type === 'status') {
              // Capture SDK session_id and model from init event and persist them.
              // I1/DP1 owner gate: a superseded turn must not write session-level
              // state — skip both writes (diagnostic-log only) if we no longer own
              // the lock.
              try {
                const statusData = JSON.parse(event.data);
                if (statusData.session_id || statusData.model) {
                  if (!isLockOwner(sessionId, lockId)) {
                    console.warn(`[chat/route] stale owner (lockId superseded), skipping status session_id/model write for session ${sessionId}`);
                  } else {
                    if (statusData.session_id) {
                      updateSdkSessionId(sessionId, statusData.session_id);
                    }
                    if (statusData.model) {
                      updateSessionModel(sessionId, statusData.model);
                    }
                  }
                }
              } catch {
                // skip malformed status data
              }
            } else if (event.type === 'task_update') {
              // Sync SDK TodoWrite tasks to local DB. I1/DP1 owner gate: a
              // superseded turn must not overwrite the new owner's task list.
              try {
                const taskData = JSON.parse(event.data);
                if (taskData.session_id && taskData.todos) {
                  if (!isLockOwner(sessionId, lockId)) {
                    console.warn(`[chat/route] stale owner (lockId superseded), skipping syncSdkTasks for session ${sessionId}`);
                  } else {
                    syncSdkTasks(taskData.session_id, taskData.todos);
                  }
                }
              } catch {
                // skip malformed task_update data
              }
            } else if (event.type === 'error') {
              hasError = true;
              errorMessage = event.data || 'Unknown error';
            } else if (event.type === 'result') {
              try {
                const resultData = JSON.parse(event.data);
                if (resultData.usage) {
                  tokenUsage = resultData.usage;
                }
                if (resultData.is_error) {
                  hasError = true;
                  // #629 — surface the result error so the empty-assistant guard
                  // below persists a visible **Error:** bubble; otherwise a failed
                  // is_error result turn looks like "no answer" after refresh.
                  if (!errorMessage) {
                    errorMessage =
                      (Array.isArray(resultData.errors) && resultData.errors.length
                        ? resultData.errors.join('\n')
                        : resultData.subtype) || 'The conversation ended with an error';
                  }
                }
                // Also capture session_id from result if we missed it from init.
                // #629 — EXCEPT a stale-resume is_error result: resultData.session_id
                // is the BAD id; persisting it would overwrite claude-client's clear
                // and make the next turn retry the broken resume. Clear it instead so
                // the next message starts fresh (DB-history rebuild).
                // I1/DP1 owner gate: a superseded turn must not write (or clear) the
                // new owner's sdk_session_id.
                if (!isLockOwner(sessionId, lockId)) {
                  console.warn(`[chat/route] stale owner (lockId superseded), skipping result sdk_session_id write for session ${sessionId}`);
                } else if (resultData.is_error && isSessionStateResultError(resultData.errors)) {
                  updateSdkSessionId(sessionId, '');
                } else if (resultData.session_id) {
                  updateSdkSessionId(sessionId, resultData.session_id);
                }
                // Memory flush tracking: log high turn counts for assistant sessions.
                // The progressive update instructions already tell the model to
                // proactively write important info to daily memory files.
                if (resultData.num_turns >= 25) {
                  console.log(`[chat API] High turn count (${resultData.num_turns}) for session ${sessionId}`);
                }
              } catch {
                // skip malformed result data
              }
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    }

    // Flush any remaining text
    if (currentText.trim()) {
      contentBlocks.push({ type: 'text', text: currentText });
    }

    // Prepend thinking block if accumulated during stream
    if (thinkingText.trim()) {
      contentBlocks.unshift({ type: 'thinking', thinking: thinkingText.trim() });
    }

    // Phase 5c slice 5 (2026-05-16, post-smoke) — when the only
    // thing the stream produced was an error event (no text, no
    // thinking, no tool call), persist a fallback assistant message
    // capturing the error. Pre-fix the proxy preflight 400 path
    // (e.g. Codex `namespace` tool tripping unsupported_tool_kind)
    // fired `event.type === 'error'` → set `hasError` + `errorMessage`,
    // then `done` closed the stream with `contentBlocks` still
    // empty. Nothing landed in DB and refresh showed only the user
    // bubble — looked like "the assistant ignored me".
    //
    // Same `**Error:** <message>` format `stream-session-manager.ts`
    // uses on the client side so the post-refresh transcript matches
    // what the live SSE showed.
    if (hasError && contentBlocks.length === 0 && errorMessage) {
      contentBlocks.push({ type: 'text', text: `**Error:** ${errorMessage}` });
    }

    if (contentBlocks.length > 0) {
      // If the message is text-only (no tool calls), store as plain text
      // for backward compatibility with existing message rendering.
      // Strip soft-heartbeat marker from text blocks before persisting (both paths)
      const heartbeatMarkerRe = /\s*<!--\s*heartbeat-done\s*-->\s*/g;
      const cleanedBlocks = contentBlocks.map(b =>
        b.type === 'text' && 'text' in b ? { ...b, text: (b.text as string).replace(heartbeatMarkerRe, '') } : b
      );

      // If it contains tool calls or thinking blocks, store as structured JSON.
      const hasStructuredBlocks = cleanedBlocks.some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'thinking'
      );

      const content = hasStructuredBlocks
        ? JSON.stringify(cleanedBlocks)
        : cleanedBlocks
            .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim();

      if (content) {
        // DP1 owner gate: a superseded turn's assistant content — even if it's
        // real, fully-formed output — must NOT be persisted into `messages`.
        // Writing it would splice a stale turn's answer into the new owner's
        // timeline (the 1.9 ordering bug). Diagnostic-log only, drop the row.
        if (!isLockOwner(sessionId, lockId)) {
          console.warn(`[chat/route] stale owner (lockId superseded) — DP1: dropping assistant message persist for session ${sessionId} (${content.length} chars not written to messages)`);
        } else {
          const savedMsg = addMessage(
            sessionId,
            'assistant',
            content,
            tokenUsage ? JSON.stringify(tokenUsage) : null,
          );
          lastSavedAssistantMsgId = savedMsg.id;
        }
      }
    }
  } catch (e) {
    hasError = true;
    errorMessage = e instanceof Error ? e.message : 'Stream reading error';
    // Stream reading error - best effort save (same structured-block handling as happy path)
    if (currentText.trim()) {
      contentBlocks.push({ type: 'text', text: currentText });
    }
    if (thinkingText.trim()) {
      contentBlocks.unshift({ type: 'thinking', thinking: thinkingText.trim() });
    }
    // Same error-visibility fallback as the happy path above —
    // applies when the SSE consumption loop itself throws (network
    // drop / parse failure) rather than receiving an error event.
    // Without this, transient stream errors also disappeared from
    // the transcript on refresh.
    if (contentBlocks.length === 0 && errorMessage) {
      contentBlocks.push({ type: 'text', text: `**Error:** ${errorMessage}` });
    }
    if (contentBlocks.length > 0) {
      const hbRe = /\s*<!--\s*heartbeat-done\s*-->\s*/g;
      const errCleanedBlocks = contentBlocks.map(b =>
        b.type === 'text' && 'text' in b ? { ...b, text: (b.text as string).replace(hbRe, '') } : b
      );
      const hasStructuredBlocks = errCleanedBlocks.some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'thinking'
      );
      const content = hasStructuredBlocks
        ? JSON.stringify(errCleanedBlocks)
        : errCleanedBlocks
            .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim();
      if (content) {
        // Keep token accounting on the error path too — the result event
        // often arrives before the exception, so usage is already known.
        // DP1 owner gate: same as the happy path — a superseded turn must not
        // persist its (error) assistant content into the new owner's timeline.
        if (!isLockOwner(sessionId, lockId)) {
          console.warn(`[chat/route] stale owner (lockId superseded) — DP1: dropping error-path assistant message persist for session ${sessionId}`);
        } else {
          addMessage(sessionId, 'assistant', content, tokenUsage ? JSON.stringify(tokenUsage) : null);
        }
      }
    }
  } finally {
    // ── Server-side completion detection (reliable path) ──
    // After persisting the assistant message, check for onboarding/checkin
    // fences and process them directly on the server. This ensures completion
    // is captured even if the frontend misses it (page refresh, parse failure, etc.).
    try {
      const fullText = contentBlocks
        .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');

      // 1. Check for onboarding-complete fence
      const completion = extractCompletion(fullText);
      if (completion) {
        const workspacePath = getSetting('assistant_workspace_path');
        const session = getSession(sessionId);
        if (workspacePath && session && session.working_directory === workspacePath) {
          await processCompletionServerSide(completion, workspacePath, sessionId);
        }
      }

      // 2a. Soft heartbeat: for normal turns in assistant projects, mark heartbeat done
      // only if the AI's response actually mentions heartbeat-related content.
      if (!opts?.isHeartbeatTurn && !hasError && fullText.trim().length > 0) {
        try {
          const workspacePath = getSetting('assistant_workspace_path');
          const session = getSession(sessionId);
          if (workspacePath && session && session.working_directory === workspacePath) {
            const { loadState, saveState, shouldRunHeartbeat } = await import('@/lib/assistant-workspace');
            const { getLocalDateString } = await import('@/lib/utils');
            const st = loadState(workspacePath);
            if (shouldRunHeartbeat(st)) {
              // Only mark done if the AI included the heartbeat-done marker.
              // The soft hint instructs the AI to append <!-- heartbeat-done --> when it checks in.
              const didCheck = fullText.includes('<!-- heartbeat-done -->');
              if (didCheck) {
                st.lastHeartbeatDate = getLocalDateString();
                saveState(workspacePath, st);
              }
            }
          }
        } catch { /* best effort */ }
      }

      // 2b. Heartbeat state update — ONLY for actual heartbeat turns, and ONLY on success
      if (opts?.isHeartbeatTurn && !hasError && fullText.trim().length > 0) {
        try {
          const workspacePath = getSetting('assistant_workspace_path');
          const session = getSession(sessionId);
          if (workspacePath && session && session.working_directory === workspacePath) {
            const { stripHeartbeatToken } = await import('@/lib/heartbeat');
            const { loadState, saveState } = await import('@/lib/assistant-workspace');
            const { getLocalDateString } = await import('@/lib/utils');
            const stripped = stripHeartbeatToken(fullText);

            const st = loadState(workspacePath);
            st.lastHeartbeatDate = getLocalDateString();

            if (stripped.shouldSkip && lastSavedAssistantMsgId) {
              // Pure HEARTBEAT_OK — mark ONLY the assistant reply as ack
              // (auto-trigger messages are not persisted, so we only have the reply)
              try {
                const { updateMessageHeartbeatAck } = await import('@/lib/db');
                updateMessageHeartbeatAck(lastSavedAssistantMsgId, true);
              } catch { /* best effort */ }
            } else if (!stripped.shouldSkip) {
              // Has real content — record for dedup
              st.lastHeartbeatText = stripped.text;
              st.lastHeartbeatSentAt = Date.now();
            }

            // Clear hookTriggeredSessionId
            if (st.hookTriggeredSessionId === sessionId || !st.hookTriggeredSessionId) {
              st.hookTriggeredSessionId = undefined;
              st.hookTriggeredAt = undefined;
            }
            saveState(workspacePath, st);
          }
        } catch {
          // best effort heartbeat state update
        }
      }
    } catch (e) {
      console.error('[chat API] Server-side completion detection failed:', e);
    }

    // Memory extraction: auto-extract durable memories every N turns (assistant projects only)
    if (!opts?.isHeartbeatTurn && !opts?.suppressNotifications) {
      try {
        const workspacePath = getSetting('assistant_workspace_path');
        const session = getSession(sessionId);
        if (workspacePath && session && session.working_directory === workspacePath) {
          const { shouldExtractMemory, hasMemoryWritesInResponse, extractMemories } = await import('@/lib/memory-extractor');

          const fullTextForMemory = contentBlocks
            .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('');

          // For memory-write detection, serialize ALL blocks (including tool_use/tool_result)
          // so that hasMemoryWritesInResponse can see memory file paths in tool calls.
          const fullResponseForWriteCheck = JSON.stringify(contentBlocks);

          // Load buddy rarity for extraction interval
          let buddyRarity: string | undefined;
          try {
            const { loadState } = await import('@/lib/assistant-workspace');
            const st = loadState(workspacePath);
            buddyRarity = st.buddy?.rarity;
          } catch { /* ignore */ }

          // Only extract if: interval met + AI didn't already write memory this turn
          if (shouldExtractMemory(buddyRarity, sessionId) && !hasMemoryWritesInResponse(fullResponseForWriteCheck)) {
            const { getMessages: getMsgs } = await import('@/lib/db');
            const { messages: recent } = getMsgs(sessionId, { limit: 6, excludeHeartbeatAck: true });
            const recentForExtraction = recent.map(m => ({ role: m.role, content: m.content }));

            // Fire-and-forget: don't block the response
            extractMemories(recentForExtraction, workspacePath).catch(() => {});
          }
        }
      } catch { /* best effort */ }
    }

    // Telegram notifications: completion or error (fire-and-forget)
    // Suppressed for auto-trigger turns (onboarding/heartbeat) — invisible system flows
    if (!opts?.suppressNotifications) {
      if (hasError) {
        notifySessionError(errorMessage, telegramOpts).catch(() => {});
      } else {
        const textSummary = contentBlocks
          .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        notifySessionComplete(textSummary || undefined, telegramOpts).catch(() => {});
      }
    }
    onComplete?.();
  }
}

/**
 * Process a detected onboarding/checkin completion on the server side.
 * Calls the shared processor functions directly — no HTTP round-trip needed.
 *
 * Both processors are internally idempotent:
 * - processOnboarding checks state.onboardingComplete
 * - processCheckin checks state.lastCheckInDate === today
 */
async function processCompletionServerSide(
  completion: import('@/lib/onboarding-completion').ExtractedCompletion,
  _workspacePath: string,
  sessionId: string,
): Promise<void> {
  try {
    if (completion.type === 'onboarding') {
      const { processOnboarding } = await import('@/lib/onboarding-processor');
      console.log('[chat API] Server-side onboarding completion detected');
      await processOnboarding(completion.answers, sessionId);
      console.log('[chat API] Server-side onboarding completion succeeded');
    } else if (completion.type === 'checkin') {
      const { processCheckin } = await import('@/lib/checkin-processor');
      console.log('[chat API] Server-side checkin completion detected');
      await processCheckin(completion.answers, sessionId);
      console.log('[chat API] Server-side checkin completion succeeded');
    }

    // Clear hookTriggeredSessionId directly (no HTTP needed).
    // CAS: only clear if we are still the owner — prevents wiping another
    // tab's legitimate lock when completions arrive out of order.
    try {
      const { loadState, saveState } = await import('@/lib/assistant-workspace');
      const { getSetting: getSettingDirect } = await import('@/lib/db');
      const wsPath = getSettingDirect('assistant_workspace_path');
      if (wsPath) {
        const state = loadState(wsPath);
        if (state.hookTriggeredSessionId === sessionId || !state.hookTriggeredSessionId) {
          state.hookTriggeredSessionId = undefined;
          state.hookTriggeredAt = undefined;
          saveState(wsPath, state);
        }
      }
    } catch {
      // Best effort
    }
  } catch (e) {
    console.error(`[chat API] Server-side ${completion.type} processing failed:`, e);
  }
}
