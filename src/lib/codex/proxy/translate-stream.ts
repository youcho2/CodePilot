/**
 * Phase 5b — ai-sdk `fullStream` → Codex Responses SSE event stream.
 *
 * `streamText({ ... }).fullStream` is an `AsyncIterable<TextStreamPart>`.
 * Codex's HTTP reader consumes a different shape: OpenAI Responses-API
 * SSE events. The translator is a long-running async generator that
 * maps ai-sdk parts to Responses events in the order Codex expects.
 *
 * Event mapping:
 *
 *   ai-sdk part                Responses events emitted
 *   ─────────────────────────  ──────────────────────────────────────
 *   start                      response.created + response.in_progress
 *   text-start                 response.output_item.added (message)
 *   text-delta                 response.output_text.delta
 *   text-end                   response.output_text.done
 *   tool-input-start           response.output_item.added (function_call)
 *   tool-input-delta           response.function_call.delta
 *   tool-call                  response.function_call.done
 *   finish                     response.completed
 *   error                      response.failed (terminal — generator returns)
 *   abort                      response.failed (code=internal_error, terminal)
 *
 * Output indexing: Codex's reader correlates `output_index` between
 * output_item.added and the per-item delta/done events. We assign
 * indices monotonically as each new top-level item starts (a text
 * block or a function call).
 *
 * Cancellation: when the caller (HTTP route) sees its request signal
 * abort, it can stop pulling from this generator — the next `for await`
 * iteration sees the underlying ai-sdk stream cancel and the generator
 * exits cleanly via the `finally` block, which still emits
 * `response.completed` (status='cancelled') if no terminal event has
 * been emitted yet.
 */

import type { TextStreamPart, ToolSet } from 'ai';
import type {
  ResponsesEvent,
  ResponsesUsage,
  ResponsesRequestBody,
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
 * a terminal event (`response.completed` or `response.failed`) exactly
 * once and then returns.
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
  const toolArgBuffers = new Map<string, string>();
  let terminalEmitted = false;

  try {
    for await (const part of source) {
      switch (part.type) {
        case 'start': {
          yield {
            type: 'response.created',
            response: {
              id: responseId,
              model: body.model,
              created_at: Math.floor(Date.now() / 1000),
            },
          };
          yield { type: 'response.in_progress', response: { id: responseId } };
          break;
        }

        case 'text-start': {
          const idx = nextOutputIndex++;
          textIndices.set(part.id, idx);
          textBuffers.set(part.id, '');
          yield {
            type: 'response.output_item.added',
            output_index: idx,
            item: { id: part.id, type: 'message', role: 'assistant' },
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
            delta: part.text,
          };
          break;
        }

        case 'text-end': {
          const idx = textIndices.get(part.id);
          if (idx === undefined) break;
          yield {
            type: 'response.output_text.done',
            output_index: idx,
            text: textBuffers.get(part.id) ?? '',
          };
          textIndices.delete(part.id);
          textBuffers.delete(part.id);
          break;
        }

        case 'tool-input-start': {
          const idx = nextOutputIndex++;
          toolIndices.set(part.id, idx);
          toolNames.set(part.id, part.toolName);
          toolArgBuffers.set(part.id, '');
          yield {
            type: 'response.output_item.added',
            output_index: idx,
            item: { id: part.id, type: 'function_call' },
          };
          break;
        }

        case 'tool-input-delta': {
          const idx = toolIndices.get(part.id);
          if (idx === undefined) break;
          toolArgBuffers.set(part.id, (toolArgBuffers.get(part.id) ?? '') + part.delta);
          yield {
            type: 'response.function_call.delta',
            output_index: idx,
            call_id: part.id,
            arguments_delta: part.delta,
          };
          break;
        }

        case 'tool-call': {
          // ai-sdk emits the final tool-call AFTER tool-input-* in
          // most providers, but a few SDKs skip the input stream and
          // jump straight to tool-call. Synthesise output_item.added
          // for that case so Codex sees a complete sequence.
          let idx = toolIndices.get(part.toolCallId);
          if (idx === undefined) {
            idx = nextOutputIndex++;
            toolIndices.set(part.toolCallId, idx);
            yield {
              type: 'response.output_item.added',
              output_index: idx,
              item: { id: part.toolCallId, type: 'function_call' },
            };
          }
          const argsJson = stringifyInput(part.input);
          yield {
            type: 'response.function_call.done',
            output_index: idx,
            call_id: part.toolCallId,
            name: part.toolName,
            arguments: argsJson,
          };
          toolIndices.delete(part.toolCallId);
          toolNames.delete(part.toolCallId);
          toolArgBuffers.delete(part.toolCallId);
          break;
        }

        case 'finish': {
          terminalEmitted = true;
          yield {
            type: 'response.completed',
            response: {
              id: responseId,
              status: 'completed',
              usage: translateUsage(part.totalUsage),
              finish_reason: translateFinishReason(part.finishReason),
            },
          };
          return;
        }

        case 'error': {
          terminalEmitted = true;
          const classified = classifyUpstreamError(part.error);
          yield {
            type: 'response.failed',
            response: { id: responseId },
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
            type: 'response.failed',
            response: { id: responseId },
            error: {
              code: 'internal_error',
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
    // response.failed so Codex sees a clean error instead of an
    // unterminated stream.
    if (!terminalEmitted) {
      terminalEmitted = true;
      const classified = classifyUpstreamError(err);
      yield {
        type: 'response.failed',
        response: { id: responseId },
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
    // a cancelled-completion so Codex's reader exits cleanly.
    if (!terminalEmitted) {
      // Generator return path inside finally: yielding here is safe
      // because the outer iteration is awaiting the next item.
       
      yield {
        type: 'response.completed',
        response: {
          id: responseId,
          status: 'cancelled',
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          finish_reason: 'error',
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

function translateUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  outputTokenDetails?: { reasoningTokens?: number };
} | undefined): ResponsesUsage {
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const total = usage?.totalTokens ?? input + output;
  const reasoning =
    usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    ...(typeof reasoning === 'number' ? { reasoning_tokens: reasoning } : {}),
  };
}

function translateFinishReason(
  reason: string | undefined,
): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | undefined {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool-calls':
      return 'tool_calls';
    case 'content-filter':
      return 'content_filter';
    case 'error':
      return 'error';
    default:
      return undefined;
  }
}
