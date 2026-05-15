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
}

// ─────────────────────────────────────────────────────────────────────
// Stream events (SSE)
//
// Codex's reader expects OpenAI Responses-API event objects. We emit a
// minimal viable subset; the reader tolerates unknown events but acts
// on the ones below:
//
//   response.created            Marker; carries response.id Codex echoes back.
//   response.in_progress        Optional; Codex shows the spinner without it.
//   response.output_item.added  Per output_item (message / function_call).
//   response.output_text.delta  Incremental assistant text. Streamed greedily.
//   response.output_text.done   Marker; emitted once per text block.
//   response.function_call.delta Tool call argument stream (matches OpenAI).
//   response.function_call.done Tool call envelope (id / name / final args).
//   response.completed          Final marker; carries usage + finish reason.
//   response.failed             Terminal error event.
// ─────────────────────────────────────────────────────────────────────

export type ResponsesEvent =
  | ResponsesCreatedEvent
  | ResponsesInProgressEvent
  | ResponsesOutputItemAddedEvent
  | ResponsesOutputTextDeltaEvent
  | ResponsesOutputTextDoneEvent
  | ResponsesFunctionCallDeltaEvent
  | ResponsesFunctionCallDoneEvent
  | ResponsesCompletedEvent
  | ResponsesFailedEvent;

export interface ResponsesCreatedEvent {
  type: 'response.created';
  response: { id: string; model: string; created_at: number };
}

export interface ResponsesInProgressEvent {
  type: 'response.in_progress';
  response: { id: string };
}

export interface ResponsesOutputItemAddedEvent {
  type: 'response.output_item.added';
  output_index: number;
  item: {
    id: string;
    type: 'message' | 'function_call';
    role?: 'assistant';
  };
}

export interface ResponsesOutputTextDeltaEvent {
  type: 'response.output_text.delta';
  output_index: number;
  delta: string;
}

export interface ResponsesOutputTextDoneEvent {
  type: 'response.output_text.done';
  output_index: number;
  text: string;
}

export interface ResponsesFunctionCallDeltaEvent {
  type: 'response.function_call.delta';
  output_index: number;
  call_id: string;
  /** Incremental argument JSON. May arrive in chunks. */
  arguments_delta: string;
}

export interface ResponsesFunctionCallDoneEvent {
  type: 'response.function_call.done';
  output_index: number;
  call_id: string;
  name: string;
  /** Final arguments JSON string. */
  arguments: string;
}

export interface ResponsesCompletedEvent {
  type: 'response.completed';
  response: {
    id: string;
    status: 'completed' | 'failed' | 'cancelled';
    usage: ResponsesUsage;
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  };
}

export interface ResponsesFailedEvent {
  type: 'response.failed';
  response: { id: string };
  error: ResponsesErrorPayload;
}

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  /** Total = input + output; Codex doesn't read total separately but
   *  including it matches the OpenAI Responses format and avoids
   *  schema-strict downstream readers. */
  total_tokens?: number;
  /** Reasoning tokens — populated when the model exposes them
   *  (o1-style reasoning models, Anthropic thinking blocks etc.).
   *  Optional; absent when the upstream doesn't report. */
  reasoning_tokens?: number;
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

export type ResponsesOutputItem =
  | { id: string; type: 'message'; role: 'assistant'; content: ResponsesContentBlock[] }
  | { id: string; type: 'function_call'; call_id: string; name: string; arguments: string };

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
  /** Provider sat in the catalog but compat tier currently has no
   *  adapter wired. Carries `compat` in context. Used as the
   *  "adapter 正在接入" surface. */
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
