/**
 * Phase 5b — SSE encoder for the Codex Responses proxy.
 *
 * Codex's HTTP client consumes the OpenAI Responses streaming format:
 *
 *   data: {"type":"response.created","response":{...}}\n
 *   data: {"type":"response.output_text.delta","delta":"hi"}\n
 *   data: {"type":"response.completed","response":{...}}\n
 *   data: [DONE]\n\n
 *
 * The encoder is intentionally bare — one `encodeEvent` for the JSON
 * frame, one `encodeDone` for the terminator. The adapter pushes
 * `ResponsesEvent` objects into a `ReadableStream<Uint8Array>` via
 * these helpers; the route file returns that stream as the response
 * body with `Content-Type: text/event-stream`.
 */

import type { ResponsesEvent, ResponsesFailedEvent } from './types';

const encoder = new TextEncoder();

export function encodeEvent(event: ResponsesEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function encodeDone(): Uint8Array {
  return encoder.encode(`data: [DONE]\n\n`);
}

/**
 * Build a single-event stream body for the "we failed before the
 * adapter ever made it to the upstream" path. Codex's reader expects
 * the failed event + DONE marker; missing DONE leaves the read loop
 * hung until the connection-level close.
 */
export function makeFailureStream(failed: ResponsesFailedEvent): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encodeEvent(failed));
      controller.enqueue(encodeDone());
      controller.close();
    },
  });
}
