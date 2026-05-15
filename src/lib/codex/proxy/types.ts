/**
 * Phase 5b — Codex Responses-API proxy types.
 *
 * Narrowed subset of OpenAI's Responses-API that Codex's HTTP client
 * sends through the `codepilot_proxy` model_provider injection
 * (see `src/lib/codex/provider-proxy.ts`). We don't try to mirror
 * the full Responses surface — only the fields Codex actually emits +
 * the events Codex's reader actually consumes.
 *
 * Source of truth for the wire shape: Codex's
 * `app-server-protocol`'s `Responses` config + Codex CLI's own
 * Responses request/response handling. CodePilot's adapter sits
 * between this wire format and the ai-sdk `LanguageModelV2` it
 * already uses for the Native runtime — provider resolution happens
 * via `createModel(...)`, and the adapter only translates the
 * Responses envelope ↔ ai-sdk `ModelMessage[] + ToolSet` /
 * `streamText` events.
 *
 * Field-level docstrings explain how each field maps to ai-sdk;
 * the adapter implementation keeps those in lockstep so a future
 * Responses-spec extension flows through with a single touch point.
 */

// ─────────────────────────────────────────────────────────────────────
// Request
// ─────────────────────────────────────────────────────────────────────

/**
 * Codex passes its accumulated turn state as `input: ResponsesInputItem[]`.
 * Three item kinds today:
 *
 *   message            user / assistant text turn
 *   function_call      assistant emitted a tool call (output role)
 *   function_call_output result of a previous function_call (user role)
 *
 * The adapter walks the array in order and flattens it into the
 * `ModelMessage[]` ai-sdk expects.
 */
export type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem;

export interface ResponsesMessageItem {
  type: 'message';
  /** Role for the turn. Codex sends `user` or `assistant`. */
  role: 'user' | 'assistant' | 'system' | 'developer';
  /** Content blocks. Codex today emits `input_text` for user input,
   *  `output_text` for assistant text. Image inputs encoded as
   *  `input_image` with a URL string. */
  content: ResponsesContentBlock[];
}

export type ResponsesContentBlock =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string }
  | { type: 'input_image'; image_url: string };

export interface ResponsesFunctionCallItem {
  type: 'function_call';
  /** Codex emits a unique id per call so subsequent function_call_output
   *  items can reference it. The adapter passes it straight through
   *  to ai-sdk's `toolCallId`. */
  call_id: string;
  /** Tool name. Matches the `name` declared in the request's `tools[]`. */
  name: string;
  /** JSON-encoded arguments. Codex sends a string (not an object) per
   *  the Responses spec. The adapter parses lazily so a malformed
   *  payload surfaces as a runtime error, not a translation error. */
  arguments: string;
}

export interface ResponsesFunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  /** Output payload — JSON-encoded if structured, raw string otherwise.
   *  ai-sdk's tool_result content takes a JSON value, so the adapter
   *  attempts JSON.parse first and falls back to the raw string. */
  output: string;
}

/**
 * Tool declaration in the Responses request.
 *
 * Codex emits the `function` shape (subset of OpenAI's tools[] schema)
 * for everything except the built-in shell/apply_patch tools. The
 * adapter forwards function tools straight to ai-sdk; built-in tools
 * are routed through CodePilot's own tool set (not yet supported in
 * this commit — adapter emits `unsupported_tool_kind` error).
 */
export type ResponsesTool = ResponsesFunctionTool;

export interface ResponsesFunctionTool {
  type: 'function';
  /** Tool identifier. Matches the `name` referenced by function_call items. */
  name: string;
  /** Short description for the model. */
  description?: string;
  /** JSON Schema for the arguments. ai-sdk consumes this verbatim. */
  parameters?: Record<string, unknown>;
  /** Strict-mode flag — ai-sdk doesn't expose a direct equivalent;
   *  the adapter ignores this field but preserves it on tool_call
   *  echo so Codex's correlator stays consistent. */
  strict?: boolean;
}

export interface ResponsesRequestBody {
  /** Model id from Codex's perspective — the codex_codepilot proxy
   *  decides what to do with it. Codex sends the model name the user
   *  picked in their flow; the adapter resolves the corresponding
   *  CodePilot provider model via `provider-resolver`. */
  model: string;
  /** Conversation state flattened into ordered items. */
  input: ResponsesInputItem[];
  /** Tool surface. `undefined` / `[]` means no tools available. */
  tools?: ResponsesTool[];
  /** Whether to stream the response. Codex defaults to `true`. */
  stream?: boolean;
  /** Instructions block — Codex's developer-message hook. The
   *  adapter passes through as a `system` ModelMessage prepended
   *  to the conversation. */
  instructions?: string;
  /** Free-form metadata. The adapter ignores. */
  metadata?: Record<string, unknown>;
  /** Reasoning effort. Codex propagates the user's `effort` selection
   *  here; the adapter forwards to ai-sdk via providerOptions when
   *  the underlying SDK accepts it (Anthropic thinking, OpenAI o1
   *  reasoning_effort, etc.). */
  reasoning?: {
    effort?: 'minimal' | 'low' | 'medium' | 'high' | 'max';
  };
  /** OpenAI Responses-API `store` field. The Codex `/responses`
   *  endpoint (chatgpt.com/backend-api/codex/responses) requires
   *  `store: false` on every call; sending true returns HTTP 400
   *  "Store must be set to false". Codex's own HTTP client always
   *  sets this field, so we preserve it and forward it via
   *  `providerOptions.openai.store` in the unified adapter. Default
   *  (when caller omits) is `false` for the openai-oauth path; other
   *  wire formats ignore the field. */
  store?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Stream events (SSE)
//
// Contract source (Phase 5b smoke round 5, 2026-05-16):
//   resources/codex/sdk/typescript/tests/responsesProxy.ts
//   resources/codex/codex-rs/core/tests/common/responses.rs
//
// Codex's reader (both the app-server's internal Responses parser AND
// the public `@openai/codex-sdk`) consumes a Responses-API subset
// where the load-bearing events are:
//
//   response.created           Marker; carries response.id Codex echoes back.
//   response.in_progress       Optional; Codex tolerates without.
//   response.output_item.added Optional but recommended; signals a new item.
//   response.output_text.delta Incremental assistant text. Streamed greedily.
//   response.output_item.done  REQUIRED to LAND an assistant message or
//                              function_call. Pre-fix smoke saw GLM/Kimi
//                              return "completed but blank" because we
//                              emitted only output_text.delta + completed
//                              without the output_item.done that drops the
//                              final item into Codex's items array.
//   response.completed         Final marker. `response.usage` only — NO
//                              `status` / `finish_reason`. Usage shape is
//                              `{ input_tokens, input_tokens_details: { cached_tokens } | null,
//                                 output_tokens, output_tokens_details: { reasoning_tokens } | null,
//                                 total_tokens }`.
//   error                      Terminal error. Shape per SDK fixture:
//                              `{ type: 'error', error: { code, message } }`.
//                              (Codex production also accepts response.failed
//                              but the SDK fixture canon is `error`; we use
//                              that for predictability.)
// ─────────────────────────────────────────────────────────────────────

export type ResponsesEvent =
  | ResponsesCreatedEvent
  | ResponsesInProgressEvent
  | ResponsesOutputItemAddedEvent
  | ResponsesOutputTextDeltaEvent
  | ResponsesOutputItemDoneEvent
  | ResponsesCompletedEvent
  | ResponsesErrorStreamEvent;

export interface ResponsesCreatedEvent {
  type: 'response.created';
  response: { id: string; model?: string; created_at?: number };
}

export interface ResponsesInProgressEvent {
  type: 'response.in_progress';
  response: { id: string };
}

/**
 * `response.output_item.added` — optional pre-amble for a new output
 * item. The SDK fixture only emits `output_item.done`; the added
 * event is what Codex's streaming reader uses to mount an
 * incremental UI slot. Phase 5b only emits `added` for message
 * items today — function_call lands wholesale in `done` since we
 * don't stream args separately.
 */
export interface ResponsesOutputItemAddedEvent {
  type: 'response.output_item.added';
  output_index?: number;
  item: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: { type: 'output_text'; text: string }[];
  };
}

export interface ResponsesOutputTextDeltaEvent {
  type: 'response.output_text.delta';
  /** `output_index` and `item_id` are optional but Codex includes
   *  both upstream. We send `item_id` when present so a future Codex
   *  version that correlates deltas to items doesn't choke. */
  output_index?: number;
  item_id?: string;
  delta: string;
}

/**
 * `response.output_item.done` — REQUIRED. Codex's
 * `handle_output_item_done` (codex-rs/core/src/stream_events_utils.rs)
 * is what records the final item into the turn's items array. Missing
 * this event = "completed but blank" UI failure.
 *
 * The `item` payload mirrors Codex's `ResponseItem` enum: message,
 * function_call, reasoning, web_search_call, image_generation_call.
 * Phase 5b only emits message + function_call. Shape is shared with
 * the non-stream `ResponsesOutputItem` declared below — they're the
 * same conceptual record (the final form of an output item).
 */
export interface ResponsesOutputItemDoneEvent {
  type: 'response.output_item.done';
  output_index?: number;
  item: ResponsesOutputItem;
}

export interface ResponsesCompletedEvent {
  type: 'response.completed';
  response: {
    id: string;
    usage?: ResponsesUsage;
  };
}

/**
 * Terminal error event. Shape from SDK responsesProxy.ts
 * `responseFailed()`: `{ type: 'error', error: { code, message } }`.
 * Phase 5b's pre-fix emitted `{ type: 'response.failed', response,
 * error }` which Codex's app-server tolerated but the SDK fixture
 * never sees.
 */
export interface ResponsesErrorStreamEvent {
  type: 'error';
  error: ResponsesErrorPayload;
}

/**
 * Usage shape per SDK fixture
 * (`sdk/typescript/tests/responsesProxy.ts` + Rust common test fixtures).
 * The `_details` fields can be `null` (matching Codex's serializer)
 * but downstream readers tolerate omission too. We always emit them
 * to stay schema-strict.
 */
export interface ResponsesUsage {
  input_tokens: number;
  input_tokens_details: { cached_tokens: number } | null;
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number } | null;
  total_tokens: number;
}

// ─────────────────────────────────────────────────────────────────────
// Non-stream response
// ─────────────────────────────────────────────────────────────────────

export interface ResponsesNonStreamResponse {
  id: string;
  object: 'response';
  created_at: number;
  status: 'completed' | 'failed' | 'cancelled';
  model: string;
  output: ResponsesOutputItem[];
  usage: ResponsesUsage;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  error?: ResponsesErrorPayload;
}

/**
 * Final shape of an output item — used both inside
 * `response.output_item.done` (SSE stream) and inside
 * `ResponsesNonStreamResponse.output[]` (non-stream JSON). Codex's
 * `handle_output_item_done` accepts this shape uniformly.
 */
export type ResponsesOutputItem =
  | { id: string; type: 'message'; role: 'assistant'; content: ResponsesContentBlock[] }
  | { id?: string; type: 'function_call'; call_id: string; name: string; arguments: string };

// ─────────────────────────────────────────────────────────────────────
// Errors
//
// Structured error envelope shared by stream `response.failed` and
// non-stream `error` field. The adapter is the single producer; all
// upstream errors (provider HTTP failures, credential missing, quota,
// timeout, tool translation errors) map to one of these codes so
// Codex's reader / our own surface can branch on code rather than
// pattern-matching the message.
// ─────────────────────────────────────────────────────────────────────

export type ResponsesErrorCode =
  /** Bad / unparseable Responses request body. */
  | 'invalid_request'
  /** `x-codepilot-target-provider` header missing or unknown. */
  | 'provider_not_targeted'
  | 'provider_not_found'
  /** Provider has no credentials configured (api_key / oauth missing). */
  | 'credentials_missing'
  /** Provider sat in the catalog but the proxy can't route the
   *  request through an adapter — almost always the `unknown` compat
   *  tier (wire format unidentified). Carries `compat` and `family`
   *  in context for diagnostics. */
  | 'adapter_not_implemented'
  /** Upstream provider returned 4xx (other than 401). */
  | 'upstream_client_error'
  /** Upstream provider returned 401. */
  | 'upstream_unauthorized'
  /** Upstream provider returned 429 / quota exceeded. */
  | 'upstream_rate_limited'
  /** Upstream provider returned 5xx. */
  | 'upstream_server_error'
  /** Total / idle timeout on the upstream call. */
  | 'upstream_timeout'
  /** Tool call referenced a tool not declared in the tools[] array. */
  | 'unknown_tool'
  /** Tool kind we don't translate yet (built-in shell / apply_patch). */
  | 'unsupported_tool_kind'
  /** Anything we didn't classify. Carries `cause` in context. */
  | 'internal_error';

export interface ResponsesErrorPayload {
  code: ResponsesErrorCode;
  /** Human-readable. UI surfaces this directly; use proper sentence
   *  with the constraint named (no codes, no stack traces). */
  message: string;
  /** Optional structured context — provider id, compat tier, upstream
   *  status code, etc. Stays JSON-serialisable. */
  context?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Adapter contract
//
// Single entry point: parse + validate the incoming request, resolve
// the target provider, route through ai-sdk, translate output. All
// the wire-format work lives behind this interface so the route file
// stays a thin HTTP shell.
// ─────────────────────────────────────────────────────────────────────

export interface ProxyHandlerInput {
  /** Raw `x-codepilot-target-provider` header value. */
  targetProviderId: string;
  /** Parsed Responses request body. */
  body: ResponsesRequestBody;
  /** Per-call abort signal — wired to the inbound request so Codex
   *  closing the connection cancels the upstream call too. */
  signal: AbortSignal;
}

export interface ProxyStreamResult {
  kind: 'stream';
  /** SSE response body — `data: ${JSON}\n\n` framed. */
  body: ReadableStream<Uint8Array>;
}

export interface ProxyNonStreamResult {
  kind: 'json';
  body: ResponsesNonStreamResponse;
}

export interface ProxyErrorResult {
  kind: 'error';
  /** HTTP status code we return to Codex's HTTP client.
   *  Stream variant: 200 + an SSE body whose first event is
   *  `response.failed`. Non-stream variant: 4xx/5xx + JSON body
   *  with `error.code`. */
  status: number;
  error: ResponsesErrorPayload;
}

export type ProxyResult = ProxyStreamResult | ProxyNonStreamResult | ProxyErrorResult;
