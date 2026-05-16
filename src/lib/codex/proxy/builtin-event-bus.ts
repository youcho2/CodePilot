/**
 * Phase 5c — Side-channel event bus for CodePilot built-in tools.
 *
 * The Codex provider proxy executes CodePilot built-in tools
 * (`codepilot_generate_image`, `codepilot_memory_recent`, ...)
 * server-side inside `streamText`'s `execute()` hook. Codex's HTTP
 * surface only conveys assistant text + Codex-native function_call
 * events — there's no Responses-API slot for "the proxy already
 * handled this tool, here's the MediaBlock CodePilot UI should
 * render". This bus is that missing slot.
 *
 * Wire:
 *   1. `CodexRuntime.stream()` subscribes with its `sessionId` BEFORE
 *      `turn/start`, so events from early tool calls don't get
 *      dropped.
 *   2. Bridge tool `execute()` (built in `builtin-bridge.ts`) emits a
 *      pair of `RuntimeRunEvent`s — `tool_started` then
 *      `tool_completed` (the latter carrying any `MediaBlock[]`).
 *   3. The runtime listener pipes each event into `canonicalToSseLine`
 *      → SSE → useSSEStream → MessageList. Same channel Codex's own
 *      `item/completed` notifications already flow through.
 *
 * Important contract points:
 *
 *   - Emit-before-subscribe is dropped. We don't buffer because a
 *     stale buffer carries cross-turn risk (last turn's image leaking
 *     into next turn's UI). The runtime always subscribes first.
 *   - Each session has its own bucket; sessions are independent.
 *   - Listener errors are caught + logged so a misbehaving renderer
 *     subscriber can't take down the proxy's `streamText` loop.
 *   - `globalThis`-attached so the proxy (Next API route module) and
 *     the runtime (separate module graph in Electron) share state.
 *     A plain module-level Map would create two buses in dev when
 *     Next hot-reloads only one of them.
 */

import type { RuntimeRunEvent } from '@/lib/runtime/contract';

interface Bus {
  subscribers: Map<string, Set<(event: RuntimeRunEvent) => void>>;
}

const GLOBAL_KEY = '__codepilotCodexBuiltinEventBus__' as const;

function getBus(): Bus {
  const g = globalThis as unknown as Record<string, Bus | undefined>;
  let bus = g[GLOBAL_KEY];
  if (!bus) {
    bus = { subscribers: new Map() };
    g[GLOBAL_KEY] = bus;
  }
  return bus;
}

/**
 * Subscribe a listener to events for a chat session.
 *
 * Returns an unsubscribe function. Multiple subscribers per session
 * are allowed (e.g. test harnesses can attach a probe alongside the
 * real runtime listener).
 */
export function subscribeBuiltinEvents(
  sessionId: string,
  listener: (event: RuntimeRunEvent) => void,
): () => void {
  if (!sessionId) {
    // Defensive: an empty sessionId would conflate runtime traffic
    // across chats. Surface as an immediate no-op + warn so the
    // caller fixes the wiring rather than getting silent cross-talk.
    console.warn('[codex.builtin-bus] subscribe called with empty sessionId — listener will never fire');
    return () => {};
  }
  const bus = getBus();
  let bucket = bus.subscribers.get(sessionId);
  if (!bucket) {
    bucket = new Set();
    bus.subscribers.set(sessionId, bucket);
  }
  bucket.add(listener);
  return () => {
    const current = bus.subscribers.get(sessionId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) bus.subscribers.delete(sessionId);
  };
}

/**
 * Emit an event to every listener attached to `sessionId`. If no
 * listener is attached, the event is dropped silently — DO NOT
 * buffer; see file-level contract note about cross-turn leakage.
 *
 * Listener exceptions are caught individually so one bad subscriber
 * can't stop other listeners from receiving the event AND can't take
 * down the bridge tool's `execute()` call.
 */
export function emitBuiltinEvent(sessionId: string, event: RuntimeRunEvent): void {
  if (!sessionId) return;
  const bus = getBus();
  const bucket = bus.subscribers.get(sessionId);
  if (!bucket || bucket.size === 0) return;
  for (const listener of bucket) {
    try {
      listener(event);
    } catch (err) {
      console.error('[codex.builtin-bus] listener threw — dropping for this dispatch only:', err);
    }
  }
}

/**
 * Test-only helper: clear every subscriber. Used to keep tests
 * hermetic when the same global bus instance is reused across them
 * (vitest / node:test isolate test files in process, but per-test
 * cleanup is still cheap insurance).
 */
export function __resetBuiltinEventBusForTests(): void {
  const bus = getBus();
  bus.subscribers.clear();
}

/** Test-only helper to assert listener counts without exporting internals. */
export function __subscriberCountForTests(sessionId: string): number {
  return getBus().subscribers.get(sessionId)?.size ?? 0;
}
