/**
 * Phase 5b — Responses tools[] → ai-sdk ToolSet.
 *
 * The adapter passes tool DEFINITIONS to ai-sdk so the model knows
 * what it can call; ai-sdk emits `tool-call` stream events for the
 * model's requests. We do NOT supply `execute` because Codex
 * executes the tool itself and supplies the result via a subsequent
 * `function_call_output` item in the next request's input. ai-sdk
 * supports definition-only tools — when `execute` is absent the
 * SDK stops at the tool-call boundary instead of fanning out.
 *
 * The translator preserves tool names verbatim so Codex's reader
 * can correlate function_call events back to its declared tools.
 */

import type { tool as aiTool } from 'ai';
import type { ResponsesTool } from './types';

/** ai-sdk ToolSet without execute — definition-only. */
export type ResponsesProxyToolSet = Record<string, ReturnType<typeof aiTool>>;

/**
 * Translate Responses tools[] into ai-sdk ToolSet keyed by tool name.
 *
 * Returns `undefined` when the input is empty so callers can omit
 * the `tools` field on streamText (ai-sdk treats `tools: undefined`
 * and `tools: {}` differently in some places — undefined is safer).
 *
 * Built-in Codex tools (`shell`, `apply_patch`) are NOT supported
 * yet; they require CodePilot to inject its own tool implementation
 * matching Codex's expected schema. This translator drops them
 * with a thrown error so the adapter can surface
 * `unsupported_tool_kind` cleanly instead of silently shipping a
 * broken tool list.
 */
export function translateResponsesTools(
  tools: ResponsesTool[] | undefined,
): ResponsesProxyToolSet | undefined {
  if (!tools || tools.length === 0) return undefined;

  const out: ResponsesProxyToolSet = {};
  for (const t of tools) {
    if (t.type !== 'function') {
      // We checked type at parse time; defensive double-check here
      // catches a future Codex schema extension reaching this layer.
      throw new Error(
        `Unsupported tool kind "${(t as { type: string }).type}". The Codex proxy currently translates only function-typed tools; built-in tools (shell, apply_patch) need a CodePilot-side implementation.`,
      );
    }
    // ai-sdk's `tool()` helper requires a JSON schema for input. If
    // the request omits parameters we synthesise an empty-object
    // schema so the SDK doesn't reject the tool declaration.
    const inputSchema = t.parameters ?? { type: 'object', properties: {}, additionalProperties: false };
    out[t.name] = {
      description: t.description ?? '',
      inputSchema,
      // Intentionally NO `execute` — ai-sdk stops at the tool-call
      // boundary and emits tool-call events the translator forwards
      // to Codex. Codex runs the tool and sends back
      // function_call_output in the next turn.
    } as unknown as ReturnType<typeof aiTool>;
  }
  return out;
}
