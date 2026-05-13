/**
 * Codex app-server JSON-RPC client.
 *
 * Phase 5 Phase 1 (2026-05-13). Implements the transport-agnostic
 * request / response / notification machinery; the concrete transport
 * (stdio readable+writable pair) is injected so unit tests can pump
 * the protocol without spawning a real `codex` binary.
 *
 * Protocol notes (per `资料/codex/codex-rs/app-server/README.md`):
 *
 * - JSON-RPC 2.0 over newline-delimited JSON on stdio.
 * - Server omits the `"jsonrpc":"2.0"` field on the wire but accepts
 *   it on incoming messages. We emit it for clarity and clients on
 *   other transports.
 * - Initialize handshake required once per connection: send
 *   `initialize` request, then `initialized` notification. Any other
 *   request before this returns "Not initialized".
 * - Backpressure: code `-32001` "Server overloaded; retry later." is
 *   retryable. Caller decides backoff policy.
 */

import type {
  CodexInitializeCapabilities,
  CodexInitializeResponse,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types';
import { CODEX_CLIENT_NAME, JSON_RPC_OVERLOADED_CODE } from './types';

/**
 * Minimal transport contract: caller provides a way to push JSON
 * strings to the server (`send`) and a way to subscribe to incoming
 * JSON strings (`onMessage`). Production wires stdio of a child
 * process; tests wire a pair of buffers.
 */
export interface CodexTransport {
  send(message: string): void | Promise<void>;
  onMessage(handler: (line: string) => void): () => void;
  /**
   * Close the transport. Returns once the underlying resource has
   * been released (process killed, socket closed, etc.).
   */
  close(): Promise<void>;
}

export interface CodexClientOptions {
  /** Client display version — surfaced to Codex for compliance logs. */
  version: string;
  /** Optional human-readable title. */
  title?: string;
  /** Optional capabilities override. */
  capabilities?: CodexInitializeCapabilities;
  /** Request timeout in ms (per-request). Default 30s. */
  requestTimeoutMs?: number;
  /** Max retries on `-32001 overloaded`. Default 3. */
  maxOverloadRetries?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: CodexRpcError | Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  method: string;
}

export class CodexRpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(args: { code: number; message: string; data?: unknown }) {
    super(args.message);
    this.name = 'CodexRpcError';
    this.code = args.code;
    this.data = args.data;
  }
  get retryable(): boolean {
    return this.code === JSON_RPC_OVERLOADED_CODE;
  }
}

export class CodexAppServerClient {
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private unsubscribe: (() => void) | null = null;
  private initializeResult: CodexInitializeResponse | null = null;
  private readonly timeoutMs: number;
  private readonly maxOverloadRetries: number;

  constructor(
    private readonly transport: CodexTransport,
    private readonly opts: CodexClientOptions,
  ) {
    this.timeoutMs = opts.requestTimeoutMs ?? 30_000;
    this.maxOverloadRetries = opts.maxOverloadRetries ?? 3;
  }

  /**
   * Attach the message-line listener. Must be called before sending
   * any request. `initialize()` calls this first.
   */
  private attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.transport.onMessage((line) => this.handleLine(line));
  }

  /**
   * Perform the handshake. Resolves with the server's initialize
   * response (userAgent + codexHome + platform info). Subsequent
   * methods will throw if called before this resolves.
   */
  async initialize(): Promise<CodexInitializeResponse> {
    if (this.initializeResult) return this.initializeResult;
    this.attach();
    const result = await this.request<CodexInitializeResponse>('initialize', {
      clientInfo: {
        name: CODEX_CLIENT_NAME,
        title: this.opts.title ?? null,
        version: this.opts.version,
      },
      capabilities: this.opts.capabilities ?? null,
    });
    this.initializeResult = result;
    // Acknowledge — server expects this notification before any
    // further request beyond `initialize`.
    await this.notify('initialized', {});
    return result;
  }

  get initialized(): boolean {
    return this.initializeResult !== null;
  }

  /** Send a request; resolves with the typed result. */
  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    let attempt = 0;
    // Overload retry loop. Each attempt uses a fresh id so a late
    // overload response from a previous attempt can't resolve the new one.
    while (true) {
      try {
        return await this.requestOnce<TResult>(method, params);
      } catch (err) {
        if (err instanceof CodexRpcError && err.retryable && attempt < this.maxOverloadRetries) {
          attempt++;
          // Exponential backoff with jitter (50–250ms × 2^attempt).
          const base = 50 + Math.random() * 200;
          await new Promise((r) => setTimeout(r, base * 2 ** (attempt - 1)));
          continue;
        }
        throw err;
      }
    }
  }

  private requestOnce<TResult>(method: string, params?: unknown): Promise<TResult> {
    if (!this.unsubscribe) this.attach();
    return new Promise<TResult>((resolve, reject) => {
      const id = this.nextId++;
      const timer =
        this.timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Codex RPC timeout: ${method} (>${this.timeoutMs}ms)`));
            }, this.timeoutMs)
          : null;
      this.pending.set(id, {
        resolve: (v) => resolve(v as TResult),
        reject,
        timer,
        method,
      });
      const message: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      };
      void Promise.resolve(this.transport.send(JSON.stringify(message))).catch((err) => {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /** Send a notification (no response). */
  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.unsubscribe) this.attach();
    const message: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };
    await this.transport.send(JSON.stringify(message));
  }

  /**
   * Subscribe to a notification method name. Returns an unsubscribe
   * function. Multiple handlers can be attached per method; they're
   * invoked in registration order.
   */
  onNotification(method: string, handler: (params: unknown) => void): () => void {
    let set = this.notificationHandlers.get(method);
    if (!set) {
      set = new Set();
      this.notificationHandlers.set(method, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  /**
   * Tear down the client. Cancels any pending requests with a
   * "client disposed" error so callers don't hang forever.
   */
  async dispose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(`Codex RPC aborted: ${pending.method} (client disposed)`));
      this.pending.delete(id);
    }
    await this.transport.close();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Wire-level message router
  // ─────────────────────────────────────────────────────────────────────

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: JsonRpcMessage;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcMessage;
    } catch (err) {
      console.warn('[codex] malformed JSON-RPC line', { line: trimmed.slice(0, 200), err });
      return;
    }

    // Response = has `id` + (`result` or `error`).
    if ('id' in parsed && parsed.id !== null && parsed.id !== undefined && ('result' in parsed || 'error' in parsed)) {
      this.routeResponse(parsed as JsonRpcResponse);
      return;
    }
    // Notification = has `method` but no `id` (or id null per error response w/o id).
    if ('method' in parsed && !('id' in parsed)) {
      this.routeNotification(parsed as JsonRpcNotification);
      return;
    }
    // Server-originated request — Codex doesn't currently send these
    // to clients, but the JSON-RPC spec allows it. Log and ignore so
    // a future protocol extension doesn't crash us.
    console.warn('[codex] unsupported server-originated message', { method: 'method' in parsed ? parsed.method : '<unknown>' });
  }

  private routeResponse(message: JsonRpcResponse): void {
    const idKey = message.id as number | string;
    const pending = this.pending.get(idKey);
    if (!pending) {
      // Late response after timeout / dispose. Drop silently — already
      // rejected by the timer path.
      return;
    }
    this.pending.delete(idKey);
    if (pending.timer) clearTimeout(pending.timer);
    if ('error' in message) {
      pending.reject(
        new CodexRpcError({
          code: message.error.code,
          message: message.error.message,
          data: message.error.data,
        }),
      );
      return;
    }
    pending.resolve((message as { result: unknown }).result);
  }

  private routeNotification(message: JsonRpcNotification): void {
    const handlers = this.notificationHandlers.get(message.method);
    if (!handlers || handlers.size === 0) return;
    for (const h of handlers) {
      try {
        h(message.params);
      } catch (err) {
        console.warn('[codex] notification handler threw', { method: message.method, err });
      }
    }
  }
}
