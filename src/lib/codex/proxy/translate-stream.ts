/**
 * Phase 5b smoke round 5 (2026-05-16) — ai-sdk `fullStream` → Codex
 * Responses SSE event stream, rewritten against the SDK fixture
 * contract.
 *
 * Contract source:
 *   - `资料/codex/sdk/typescript/tests/responsesProxy.ts`
 *     (`responseStarted` / `assistantMessage` / `shell_call` /
 *     `responseCompleted` / `responseFailed`)
 *   - `资料/codex/codex-rs/core/tests/common/responses.rs`
 *     (`ev_assistant_message` / `ev_function_call` / `ev_completed`)
 *
 * Event mapping:
 *
 *   ai-sdk part                Responses events emitted
 *   ─────────────────────────  ──────────────────────────────────────
 *   start                      response.created
 *   text-start                 response.output_item.added (message, empty content)
 *   text-delta                 response.output_text.delta
 *   text-end                   response.output_item.done (message with accumulated text)
 *   tool-input-start           response.output_item.added (function_call placeholder)
 *   tool-input-delta           (dropped — SDK fixture doesn't model partial-arg streaming;
 *                               function_call lands wholesale in output_item.done)
 *   tool-call                  response.output_item.done (function_call with call_id/name/arguments)
 *   finish                     response.completed { response: { id, usage } }
 *   error                      { type: 'error', error: { code, message } }
 *   abort                      { type: 'error', error: { code: 'upstream_timeout', message } }
 *
 * Why `output_item.done` is mandatory:
 * Codex's `handle_output_item_done` (codex-rs/core/src/stream_events_utils.rs)
 * is what drops the final item into the turn's items array. Pre-fix
 * smoke saw GLM/Kimi return "completed but blank" because we emitted
 * only `output_text.delta` + `completed` without the wrapping
 * `output_item.done` event. The SDK fixture confirms: even when there's
 * no streaming, `assistantMessage()` lands as a single
 * `output_item.done(message)` and the turn shows correctly.
 *
 * Cancellation: when the caller (HTTP route) sees its request signal
 * abort, it can stop pulling from this generator. The next `for await`
 * iteration sees the underlying ai-sdk stream cancel and the generator
 * exits cleanly via the `finally` block, which still emits a clean
 * `response.completed` with zero usage if no terminal event has been
 * emitted yet.
 */

import type { TextStreamPart, ToolSet } from 'ai';
import type {
  ResponsesEvent,
  ResponsesUsage,
  ResponsesRequestBody,
  ResponsesOutputItem,
} from './types';
import { classifyUpstreamError } from './errors';

interface TranslateStreamOptions {
  responseId: string;
  body: ResponsesRequestBody;
  /** ai-sdk fullStream. Tools type is intentionally unconstrained —
   *  the translator only reads on `type` discriminants. */
  source: AsyncIterable<TextStreamPart<ToolSet>>;
}

/**
 * Yield Responses events for each ai-sdk part. The generator emits
 * a terminal event (`response.completed` or `error`) exactly once
 * and then returns.
 */
export async function* translateStream(
  opts: TranslateStreamOptions,
): AsyncGenerator<ResponsesEvent, void, void> {
  const { responseId, body, source } = opts;

  let nextOutputIndex = 0;
  const textIndices = new Map<string, number>();
  const textBuffers = new Map<string, string>();
  const toolIndices = new Map<string, number>();
  const toolNames = new Map<string, string>();
  let terminalEmitted = false;

  try {
    for await (const part of source) {
      switch (part.type) {
        case 'start': {
          // Carry model + created_at (both optional per SDK fixture)
          // for back-compat with any reader that wants to echo them.
          yield {
            type: 'response.created',
            response: {
              id: responseId,
              model: body.model,
              created_at: Math.floor(Date.now() / 1000),
            },
          };
          break;
        }

        case 'text-start': {
          const idx = nextOutputIndex++;
          textIndices.set(part.id, idx);
          textBuffers.set(part.id, '');
          // `output_item.added` is the optional pre-amble. The SDK
          // fixture only emits `output_item.done`, but Codex's
          // streaming reader uses the added event to mount the
          // incremental UI. Include `content: []` so the shape
          // matches Codex's ResponseItem::Message variant exactly.
          yield {
            type: 'response.output_item.added',
            output_index: idx,
            item: { id: part.id, type: 'message', role: 'assistant', content: [] },
          };
          break;
        }

        case 'text-delta': {
          const idx = textIndices.get(part.id);
          if (idx === undefined) break;
          textBuffers.set(part.id, (textBuffers.get(part.id) ?? '') + part.text);
          yield {
            type: 'response.output_text.delta',
            output_index: idx,
            item_id: part.id,
            delta: part.text,
          };
          break;
        }

        case 'text-end': {
          // Drop the final `output_item.done` carrying the FULL
          // assistant message. This is the event Codex's
          // `handle_output_item_done` consumes to record the item.
          const idx = textIndices.get(part.id);
          if (idx === undefined) break;
          const finalText = textBuffers.get(part.id) ?? '';
          const item: ResponsesOutputItem = {
            id: part.id,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: finalText }],
          };
          yield {
            type: 'response.output_item.done',
            output_index: idx,
            item,
          };
          textIndices.delete(part.id);
          textBuffers.delete(part.id);
          break;
        }

        case 'tool-input-start': {
          // Reserve the output_index but DON'T emit output_item.added
          // here — the SDK fixture only ever emits function_call
          // wholesale in `output_item.done`. Codex's reader doesn't
          // need a pre-amble for function calls (no streaming arg
          // surface). Pre-fix we sent a half-shaped `added` event
          // with empty args that Codex's deserializer dropped.
          const idx = nextOutputIndex++;
          toolIndices.set(part.id, idx);
          toolNames.set(part.id, part.toolName);
          break;
        }

        case 'tool-input-delta': {
          // SDK fixture doesn't model partial-arg streaming; Codex
          // landed function_call arguments wholesale in the `done`
          // event. We drop the delta here rather than emit a
          // non-canonical event that no Codex reader consumes —
          // pre-fix the smoke saw `function_call.delta` events that
          // never showed up downstream, just noise on the wire.
          break;
        }

        case 'tool-call': {
          // Final function_call envelope lands as `output_item.done`.
          // If the upstream skipped `tool-input-start` (some SDKs
          // emit only `tool-call`), synthesise the index here.
          let idx = toolIndices.get(part.toolCallId);
          if (idx === undefined) {
            idx = nextOutputIndex++;
            toolIndices.set(part.toolCallId, idx);
          }
          const argsJson = stringifyInput(part.input);
          const item: ResponsesOutputItem = {
            id: part.toolCallId,
            type: 'function_call',
            call_id: part.toolCallId,
            name: part.toolName,
            arguments: argsJson,
          };
          yield {
            type: 'response.output_item.done',
            output_index: idx,
            item,
          };
          toolIndices.delete(part.toolCallId);
          toolNames.delete(part.toolCallId);
          break;
        }

        case 'finish': {
          // Flush any text blocks that didn't get a text-end (some
          // upstreams skip it on natural completion). Without this,
          // Codex sees no output_item.done for the message and the
          // turn renders blank — the GLM/Kimi failure mode.
          for (const [id, idx] of textIndices.entries()) {
            const finalText = textBuffers.get(id) ?? '';
            const item: ResponsesOutputItem = {
              id,
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: finalText }],
            };
            yield {
              type: 'response.output_item.done',
              output_index: idx,
              item,
            };
          }
          textIndices.clear();
          textBuffers.clear();

          terminalEmitted = true;
          yield {
            type: 'response.completed',
            response: {
              id: responseId,
              usage: translateUsage(part.totalUsage),
            },
          };
          return;
        }

        case 'error': {
          terminalEmitted = true;
          const classified = classifyUpstreamError(part.error);
          yield {
            type: 'error',
            error: {
              code: classified.code,
              message: classified.message,
              context: classified.context,
            },
          };
          return;
        }

        case 'abort': {
          terminalEmitted = true;
          yield {
            type: 'error',
            error: {
              code: 'upstream_timeout',
              message: part.reason
                ? `Stream aborted: ${part.reason}`
                : 'Stream aborted by upstream.',
            },
          };
          return;
        }

        // The remaining ai-sdk parts (reasoning-*, source, file,
        // tool-result, tool-error, start-step, finish-step, raw,
        // tool-output-denied) don't map onto the Codex-visible
        // surface today — we drop them silently. Reasoning content
        // would need provider-specific routing back to Codex's
        // reasoning event; that's a separate phase.
        default:
          break;
      }
    }
  } catch (err) {
    // Iterator-side error (network drop, upstream throw). Map to
    // the SDK-fixture-shaped `error` event so Codex sees a clean
    // failure instead of an unterminated stream.
    if (!terminalEmitted) {
      terminalEmitted = true;
      const classified = classifyUpstreamError(err);
      yield {
        type: 'error',
        error: {
          code: classified.code,
          message: classified.message,
          context: classified.context,
        },
      };
    }
    return;
  } finally {
    // Upstream closed without emitting a terminal event — synthesise
    // a zero-usage completion so Codex's reader exits cleanly.
    if (!terminalEmitted) {
      yield {
        type: 'response.completed',
        response: {
          id: responseId,
          usage: emptyUsage(),
        },
      };
    }
  }
}

/** Coerce ai-sdk `input` to the JSON string Codex expects. */
function stringifyInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return '{}';
  try {
    return JSON.stringify(input);
  } catch {
    return '{}';
  }
}

function emptyUsage(): ResponsesUsage {
  return {
    input_tokens: 0,
    input_tokens_details: null,
    output_tokens: 0,
    output_tokens_details: null,
    total_tokens: 0,
  };
}

function translateUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
} | undefined): ResponsesUsage {
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const total = usage?.totalTokens ?? input + output;
  const cached = usage?.inputTokenDetails?.cacheReadTokens;
  const reasoning =
    usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens;
  return {
    input_tokens: input,
    input_tokens_details: typeof cached === 'number' ? { cached_tokens: cached } : null,
    output_tokens: output,
    output_tokens_details: typeof reasoning === 'number' ? { reasoning_tokens: reasoning } : null,
    total_tokens: total,
  };
}
