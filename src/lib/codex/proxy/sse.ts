/**
 * Phase 5b — SSE encoder for the Codex Responses proxy.
 *
 * Codex's HTTP client (and the official `@openai/codex-sdk`'s
 * `responsesProxy.ts` test fixture, which is the canonical contract
 * source) consumes the OpenAI Responses streaming format with the
 * `event: <type>` line REQUIRED in every frame:
 *
 *   event: response.created\n
 *   data: {"type":"response.created","response":{"id":"..."}}\n\n
 *
 *   event: response.output_text.delta\n
 *   data: {"type":"response.output_text.delta","delta":"hi"}\n\n
 *
 *   event: response.output_item.done\n
 *   data: {"type":"response.output_item.done","item":{...}}\n\n
 *
 *   event: response.completed\n
 *   data: {"type":"response.completed","response":{...}}\n\n
 *
 *   data: [DONE]\n\n
 *
 * Pre-fix this encoder emitted only `data: ...` lines. Codex tolerated
 * `response.created` / `response.completed` either way but the SDK's
 * fixture explicitly tags every event, so we now match the fixture
 * to avoid quirks downstream.
 *
 * The encoder is intentionally bare — one `encodeEvent` for the JSON
 * frame, one `encodeDone` for the terminator. The adapter pushes
 * `ResponsesEvent` objects into a `ReadableStream<Uint8Array>` via
 * these helpers; the route file returns that stream as the response
 * body with `Content-Type: text/event-stream`.
 */

import type { ResponsesEvent, ResponsesErrorStreamEvent } from './types';

const encoder = new TextEncoder();

export function encodeEvent(event: ResponsesEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function encodeDone(): Uint8Array {
  return encoder.encode(`data: [DONE]\n\n`);
}

/**
 * Build a single-event stream body for the "we failed before the
 * adapter ever made it to the upstream" path. Codex's reader expects
 * the error event + DONE marker; missing DONE leaves the read loop
 * hung until the connection-level close. The error shape is
 * `{ type: 'error', error: { code, message } }` per the SDK fixture
 * (`sdk/typescript/tests/responsesProxy.ts:responseFailed()`).
 */
export function makeFailureStream(failed: ResponsesErrorStreamEvent): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encodeEvent(failed));
      controller.enqueue(encodeDone());
      controller.close();
    },
  });
}
