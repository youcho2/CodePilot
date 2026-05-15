/**
 * Phase 5b — Responses input items → ai-sdk ModelMessage[].
 *
 * Codex sends turn state as a flat `ResponsesInputItem[]`. ai-sdk's
 * `streamText` consumes `messages: ModelMessage[]` with the
 * conversation already arranged into role-tagged turns. The
 * translator walks the input array and emits one ModelMessage per
 * logical turn, merging contiguous function_call_output items into
 * the tool-result message they belong to.
 *
 * Mapping:
 *
 *   { type: 'message', role: 'user', content: [{ input_text }, ...] }
 *     → { role: 'user', content: <flattened> }
 *   { type: 'message', role: 'assistant', content: [{ output_text }, ...] }
 *     → { role: 'assistant', content: <flattened> }
 *   { type: 'function_call', ... }
 *     → assistant message with content: [{ type: 'tool-call', ... }]
 *       (merged into the previous assistant message if it exists)
 *   { type: 'function_call_output', ... }
 *     → tool message: { role: 'tool', content: [{ type: 'tool-result', ... }] }
 *
 * Image content blocks (input_image) pass through as ai-sdk's
 * `ImagePart`. Codex doesn't currently emit those for chat, but the
 * adapter handles them so we don't surprise a future Codex version.
 *
 * Reasoning blocks (Anthropic thinking) inside the assistant
 * message would need a per-SDK provider-specific path; Codex doesn't
 * emit them in the request today, so we don't translate them here.
 */

import type { ModelMessage } from 'ai';
import type {
  ResponsesInputItem,
  ResponsesContentBlock,
} from './types';

/** Mirror of ai-sdk's JSONValue — recursive primitive/array/object. */
type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Translate a Responses input array into ai-sdk ModelMessage[].
 * Caller prepends the system message (from `instructions`) if any.
 */
export function translateResponsesInput(
  input: ResponsesInputItem[],
): ModelMessage[] {
  const out: ModelMessage[] = [];

  for (const item of input) {
    if (item.type === 'message') {
      if (item.role === 'system' || item.role === 'developer') {
        // ai-sdk treats developer as system. Both map to the
        // `system` role since the SDK doesn't expose a developer
        // distinction.
        out.push({
          role: 'system',
          content: flattenTextOnly(item.content),
        });
      } else if (item.role === 'user') {
        out.push({
          role: 'user',
          content: translateUserContent(item.content),
        });
      } else if (item.role === 'assistant') {
        out.push({
          role: 'assistant',
          content: translateAssistantContent(item.content),
        });
      }
    } else if (item.type === 'function_call') {
      // Merge into the previous assistant message if the previous
      // item was already an assistant message (typical Codex shape:
      // assistant text → function_call → function_call →
      // function_call_output → assistant text). ai-sdk's tool-call
      // content part lives on the assistant message.
      const prev = out[out.length - 1];
      const toolCallPart = {
        type: 'tool-call' as const,
        toolCallId: item.call_id,
        toolName: item.name,
        input: safeParseJson(item.arguments) ?? item.arguments,
      };
      if (prev && prev.role === 'assistant' && Array.isArray(prev.content)) {
        prev.content.push(toolCallPart);
      } else {
        out.push({
          role: 'assistant',
          content: [toolCallPart],
        });
      }
    } else if (item.type === 'function_call_output') {
      // ai-sdk tool result messages MUST come after the matching
      // assistant tool-call. Codex always emits them in order, so
      // we just push a new tool message here. ai-sdk merges
      // consecutive tool messages internally.
      //
      // Output is JSON-parsed when possible (so the model sees a
      // structured value), falls back to plain text otherwise. This
      // matches how Codex itself encodes tool output downstream.
      const parsed = safeParseJson(item.output);
      const output = parsed !== undefined
        ? { type: 'json' as const, value: parsed as JsonValue }
        : { type: 'text' as const, value: item.output };
      out.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: item.call_id,
            toolName: '__from_responses_proxy__', // ai-sdk doesn't use this for routing; the toolCallId is the matcher
            output,
          },
        ],
      });
    }
  }

  return out;
}

/** Best-effort JSON.parse — returns undefined on failure. */
function safeParseJson(raw: string): unknown | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Flatten text-only content (for system / developer roles). */
function flattenTextOnly(content: ResponsesContentBlock[]): string {
  return content
    .filter(b => b.type === 'input_text' || b.type === 'output_text')
    .map(b => (b.type === 'input_text' || b.type === 'output_text') ? b.text : '')
    .join('\n');
}

type UserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string };

/** Translate user-side content (text + image) for ai-sdk. */
function translateUserContent(content: ResponsesContentBlock[]): UserContentPart[] {
  const parts: UserContentPart[] = [];
  for (const block of content) {
    if (block.type === 'input_text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'output_text') {
      // Shouldn't normally appear on a user message, but Codex may
      // include echoed text in odd cases. Treat as plain text.
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'input_image') {
      parts.push({ type: 'image', image: block.image_url });
    }
  }
  return parts;
}

type AssistantContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown };

/** Translate assistant-side content (text only at this layer — tool calls handled separately). */
function translateAssistantContent(content: ResponsesContentBlock[]): AssistantContentPart[] {
  const parts: AssistantContentPart[] = [];
  for (const block of content) {
    if (block.type === 'output_text' || block.type === 'input_text') {
      parts.push({ type: 'text', text: block.text });
    }
    // input_image on assistant role: shouldn't happen; ignore.
  }
  return parts;
}
