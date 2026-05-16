/**
 * Phase 5b — Unified Responses adapter built on ai-sdk.
 *
 * Same translator works for all three adapter families (OpenAI-compat,
 * Anthropic-compat, CodePlan) because the wire-format divergence lives
 * INSIDE ai-sdk's per-provider SDK (createAnthropic / createOpenAI /
 * createGoogleGenerativeAI / etc.). CodePilot's `createModel()` factory
 * already picks the right SDK based on `ResolvedProvider.sdkType`, so
 * once the Responses ↔ ModelMessage[] translation is done, the adapter
 * just hands the model to `streamText` / `generateText` and translates
 * the result back. The family-by-family registration in `adapter.ts`
 * is therefore a dispatch + gate concern, not a separate translator.
 *
 * Two paths:
 *
 *   stream:true  (default)  → `streamText` + `translateStream`
 *                              Returns a ReadableStream<Uint8Array>
 *                              of SSE-framed Responses events.
 *   stream:false            → `generateText` + `translateNonStreamResponse`
 *                              Returns a full JSON ResponsesNonStreamResponse.
 *
 * Adapter never throws — every failure path maps to a Responses-shaped
 * error via `classifyUpstreamError` / `makeFailureStream`.
 */

import {
  streamText,
  generateText,
  stepCountIs,
  type ModelMessage,
  type LanguageModel,
  type ToolSet,
} from 'ai';
import { createModel } from '@/lib/ai-provider';
import { translateResponsesInput } from './translate-input';
import { translateResponsesTools } from './translate-tools';
import { translateStream } from './translate-stream';
import { translateNonStreamResponse } from './translate-response';
import { encodeEvent, encodeDone, makeFailureStream } from './sse';
import { makeErrorResult, classifyUpstreamError } from './errors';
import { createCodePilotBuiltinTools } from './builtin-bridge';
import type { ResponsesAdapter } from './adapter';
import type {
  ResponsesEvent,
  ResponsesRequestBody,
  ProxyResult,
} from './types';

/** JSON value type matching ai-sdk's SharedV3ProviderOptions inner. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type AiProviderOptions = Record<string, JsonObject>;

/**
 * Build the unified adapter. The family parameter is accepted but
 * doesn't change behaviour today — it's threaded into error context
 * so a failure surface tells us *which family* hit the issue without
 * needing to grep through provider ids. When a family later needs a
 * provider-specific tweak (e.g. CodePlan brand requires header X),
 * branch on it here rather than splitting into N adapter files.
 */
export function createUnifiedAdapter(family: string): ResponsesAdapter {
  return async (input, resolved): Promise<ProxyResult> => {
    const responseId = makeResponseId();

    // 1. Resolve the LanguageModel via the same factory native uses.
    //    Pass the RAW targetProviderId from the inbound header — NOT
    //    `resolved.provider?.id` — so virtual providers like
    //    `openai-oauth` (which have `resolved.provider === undefined`)
    //    flow through to ai-provider.ts's per-virtual-id branches
    //    (createOpenAI with Codex endpoint + OAuth fetch, etc.).
    //    Dropping the id here was the original Phase 5b P0 bug: the
    //    proxy route accepted openai-oauth then silently fell back to
    //    the default provider inside createModel.
    let languageModel: LanguageModel;
    try {
      const created = createModel({
        providerId: input.targetProviderId,
        model: input.body.model,
      });
      languageModel = created.languageModel;
    } catch (err) {
      const classified = classifyUpstreamError(err);
      return makeErrorResult(classified.code, classified.message, {
        ...classified.context,
        family,
        providerId: input.targetProviderId,
      });
    }

    // 2. Translate Responses input → ai-sdk messages + tools.
    let messages: ModelMessage[];
    let codexTools: ToolSet | undefined;
    try {
      messages = buildMessages(input.body);
      codexTools = translateResponsesTools(input.body.tools) as ToolSet | undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = /unsupported tool kind/i.test(message)
        ? 'unsupported_tool_kind'
        : 'invalid_request';
      return makeErrorResult(code, message, { family });
    }

    // Phase 5c (2026-05-16) — mount the CodePilot built-in tool
    // bridge. The bridge returns an empty result when the runtime
    // didn't supply a sessionId (older builds / chat-less smoke) or
    // when the target is codex_account — in both cases the rest of
    // the adapter behaves exactly as it did pre-5c.
    //
    // Built-in tools take PRIORITY over any same-name function tool
    // Codex may have sent (it shouldn't — Codex tools are prefixed
    // with non-`codepilot_` names — but defence in depth so future
    // Codex schema overlap can't silently replace our handler with
    // a no-op).
    const bridge = createCodePilotBuiltinTools({
      sessionId: input.sessionId,
      workspacePath: input.workspacePath,
      targetProviderId: input.targetProviderId,
    });
    const tools: ToolSet | undefined = mergeToolSets(codexTools, bridge.tools);

    // Prepend the bridge's system prompt to Codex's `instructions`
    // so the model knows which built-in tools exist + when to use
    // them. We splice rather than overwrite — Codex's instructions
    // contain user-facing copy we MUST NOT drop.
    const bodyWithBridgePrompt = bridge.systemPrompt.length > 0
      ? { ...input.body, instructions: combineInstructions(input.body.instructions, bridge.systemPrompt) }
      : input.body;

    const providerOptions = buildProviderOptions(bodyWithBridgePrompt);
    const wantsStream = input.body.stream !== false;

    if (wantsStream) {
      return streamPath({
        responseId,
        body: bodyWithBridgePrompt,
        languageModel,
        messages,
        tools,
        builtinToolNames: bridge.toolNames,
        providerOptions,
        signal: input.signal,
        family,
      });
    }

    return nonStreamPath({
      responseId,
      body: bodyWithBridgePrompt,
      languageModel,
      messages,
      tools,
      builtinToolNames: bridge.toolNames,
      providerOptions,
      signal: input.signal,
      family,
    });
  };
}

/**
 * Merge Codex's function tools with the bridge's executable tools.
 * Bridge tools win on name collision (see comment in the call site).
 * Returns `undefined` when both sides are empty so ai-sdk gets the
 * "no tools" signal (it distinguishes `tools: undefined` from
 * `tools: {}` in some places).
 */
function mergeToolSets(codex: ToolSet | undefined, bridge: ToolSet): ToolSet | undefined {
  const merged: ToolSet = { ...(codex ?? {}), ...bridge };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function combineInstructions(codexInstructions: string | undefined, bridgePrompt: string): string {
  if (!codexInstructions || codexInstructions.length === 0) return bridgePrompt;
  // Bridge prompt FIRST so the tool capability declarations land at
  // the top of the system message; Codex's own instructions follow
  // and can still reference them.
  return `${bridgePrompt}\n\n${codexInstructions}`;
}

interface PathInput {
  responseId: string;
  body: ResponsesRequestBody;
  languageModel: LanguageModel;
  messages: ModelMessage[];
  tools: ToolSet | undefined;
  /** Names belonging to the bridge — Codex doesn't need their
   *  function_call events because the bridge already executed them.
   *  See `translate-stream.ts` for the suppression logic. */
  builtinToolNames: ReadonlySet<string>;
  providerOptions: AiProviderOptions | undefined;
  signal: AbortSignal;
  family: string;
}

/**
 * Phase 5c (2026-05-16) — multi-step ceiling for streamText.
 *
 * Codex's protocol expects a single response per HTTP call, but
 * ai-sdk lets the model continue after a server-side tool execute()
 * returns. The bridge needs that loop so `codepilot_generate_image`
 * can produce an image AND the model can follow up with explanatory
 * text in the same turn — without `stopWhen` ai-sdk stops after the
 * first step (legacy behaviour). 8 is empirical: enough for chained
 * tools (memory read → image gen → narration → schedule task), low
 * enough that a confused model loop terminates instead of looping
 * indefinitely on tool calls.
 */
const BUILTIN_BRIDGE_STEP_LIMIT = 8;

function streamPath(args: PathInput): ProxyResult {
  const { responseId, body, languageModel, messages, tools, builtinToolNames, providerOptions, signal, family } = args;

  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model: languageModel,
      messages,
      tools,
      providerOptions,
      abortSignal: signal,
      // Phase 5c: only enable multi-step when bridge tools are
      // actually mounted. For pre-5c chat-only smoke runs (no
      // sessionId, no bridge), keep the single-step legacy behaviour
      // so we don't accidentally change the wire of currently passing
      // smoke matrix entries.
      ...(builtinToolNames.size > 0 ? { stopWhen: stepCountIs(BUILTIN_BRIDGE_STEP_LIMIT) } : {}),
    });
  } catch (err) {
    const classified = classifyUpstreamError(err);
    return {
      kind: 'stream',
      body: makeFailureStream({
        type: 'response.failed',
        response: {
          id: responseId,
          error: {
            code: classified.code,
            message: classified.message,
          },
        },
      }),
    };
  }

  const sseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const events = translateStream({
          responseId,
          body,
          source: result.fullStream,
          builtinToolNames,
        });
        for await (const event of events) {
          controller.enqueue(encodeEvent(event));
        }
        controller.enqueue(encodeDone());
      } catch (err) {
        const classified = classifyUpstreamError(err);
        const failed: ResponsesEvent = {
          type: 'response.failed',
          response: {
            id: responseId,
            error: {
              code: classified.code,
              message: classified.message,
            },
          },
        };
        controller.enqueue(encodeEvent(failed));
        controller.enqueue(encodeDone());
      } finally {
        controller.close();
      }
    },
    cancel() {
      // The translator's `for await` exits when the source stream
      // closes; ai-sdk cancels the upstream call via abortSignal.
    },
  });

  return { kind: 'stream', body: sseStream };
}

async function nonStreamPath(args: PathInput): Promise<ProxyResult> {
  const { responseId, body, languageModel, messages, tools, builtinToolNames, providerOptions, signal, family } = args;
  try {
    const result = await generateText({
      model: languageModel,
      messages,
      tools,
      providerOptions,
      abortSignal: signal,
      // Same step ceiling as streamPath — kept symmetric so the
      // non-stream path doesn't surprise callers that switch
      // between stream:true/false at runtime.
      ...(builtinToolNames.size > 0 ? { stopWhen: stepCountIs(BUILTIN_BRIDGE_STEP_LIMIT) } : {}),
    });
    const responseBody = translateNonStreamResponse({
      responseId,
      model: body.model,
      result: {
        text: result.text,
        toolCalls: result.toolCalls.map(c => ({
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: c.input,
        })),
        finishReason: result.finishReason,
        totalUsage: result.totalUsage,
        usage: result.usage,
      },
      builtinToolNames,
    });
    return { kind: 'json', body: responseBody };
  } catch (err) {
    const classified = classifyUpstreamError(err);
    return makeErrorResult(classified.code, classified.message, {
      ...classified.context,
      family,
    });
  }
}

/** Prepend the `instructions` system message if Codex supplied one. */
function buildMessages(body: ResponsesRequestBody): ModelMessage[] {
  const translated = translateResponsesInput(body.input);
  if (body.instructions && body.instructions.length > 0) {
    return [{ role: 'system', content: body.instructions }, ...translated];
  }
  return translated;
}

/**
 * Translate Codex's `reasoning.effort` into per-SDK providerOptions.
 *
 * Anthropic exposes thinking budget via `providerOptions.anthropic.thinking`.
 * OpenAI Responses-API exposes reasoning via `providerOptions.openai.reasoningEffort`.
 * Other SDKs ignore unknown keys.
 *
 * The translator picks BOTH possible paths so whichever underlying SDK
 * is used picks up the option without the adapter needing to know
 * which one upfront. ai-sdk silently drops options the model doesn't
 * recognise — confirmed by reading providerOptions handling in each
 * @ai-sdk/* package.
 */
/** Exported for unit testing — see codex-proxy-translators.test.ts. */
export function buildProviderOptions(
  body: ResponsesRequestBody,
): AiProviderOptions | undefined {
  const out: AiProviderOptions = {};

  // Phase 5b smoke follow-up (2026-05-15) — Codex's `/responses`
  // endpoint (chatgpt.com/backend-api/codex/responses) REQUIRES a
  // non-empty `instructions` top-level field. ai-sdk's openai
  // `responses(...)` model only populates that field from
  // `providerOptions.openai.instructions` — system messages in the
  // `messages` array end up as input items, not as the top-level
  // instructions. So forward Codex's body.instructions verbatim into
  // the provider options so the openai-oauth path stops returning
  // HTTP 400 "Instructions are required". Harmless for other openai
  // wire targets (regular openai.chat / .responses both accept it).
  if (body.instructions && body.instructions.trim().length > 0) {
    out.openai = { ...(out.openai ?? {}), instructions: body.instructions };
  }

  // Phase 5b smoke follow-up (2026-05-15) — Codex's `/responses`
  // endpoint also REQUIRES `store: false`. ai-sdk's openai `responses(...)`
  // path defaults store to true (the public OpenAI API stores by
  // default for the dashboard). When Codex's HTTP client forwards a
  // body with `store: false` we honour it; when it's absent we still
  // force false because the Codex endpoint never accepts true. Other
  // openai targets (public OpenAI, OpenRouter `/v1`) tolerate
  // `store: false` so this is safe to set unconditionally on every
  // openai-flavoured call we make.
  out.openai = { ...(out.openai ?? {}), store: body.store ?? false };

  const effort = body.reasoning?.effort;
  if (effort) {
    // Anthropic thinking — only enabled for medium/high/max budgets.
    // Mapping mirrors how CodePilot's native runtime maps effort →
    // budget (see src/lib/effort.ts for the canonical table).
    const anthropicThinking = mapEffortToAnthropicThinking(effort);
    const openaiReasoning = mapEffortToOpenAI(effort);
    if (anthropicThinking) {
      out.anthropic = { thinking: { type: anthropicThinking.type, budgetTokens: anthropicThinking.budgetTokens } };
    }
    if (openaiReasoning) {
      out.openai = { ...(out.openai ?? {}), reasoningEffort: openaiReasoning };
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function mapEffortToAnthropicThinking(
  effort: 'minimal' | 'low' | 'medium' | 'high' | 'max',
): { type: 'enabled'; budgetTokens: number } | undefined {
  switch (effort) {
    case 'low':
      return { type: 'enabled', budgetTokens: 1024 };
    case 'medium':
      return { type: 'enabled', budgetTokens: 4096 };
    case 'high':
      return { type: 'enabled', budgetTokens: 16384 };
    case 'max':
      return { type: 'enabled', budgetTokens: 32000 };
    case 'minimal':
    default:
      return undefined;
  }
}

function mapEffortToOpenAI(
  effort: 'minimal' | 'low' | 'medium' | 'high' | 'max',
): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  switch (effort) {
    case 'minimal':
      return 'minimal';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'max':
      return 'high';
    default:
      return undefined;
  }
}

function makeResponseId(): string {
  return `resp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
