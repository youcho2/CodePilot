/**
 * Phase 5 Phase 1 — Codex app-server JSON-RPC client contract.
 *
 * Tests run against a mocked `CodexTransport` — no real `codex`
 * binary required. Covers:
 *
 *   - initialize() round-trip + initialized notification
 *   - request<T>() resolves with typed result
 *   - request<T>() rejects with CodexRpcError on error response
 *   - notification handlers receive matching method payloads
 *   - overload (-32001) retries up to maxOverloadRetries
 *   - dispose() rejects pending requests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CodexAppServerClient,
  CodexRpcError,
  type CodexTransport,
} from '@/lib/codex/app-server-client';
import { CODEX_CLIENT_NAME, JSON_RPC_OVERLOADED_CODE } from '@/lib/codex/types';

function makeMockTransport() {
  let messageHandler: ((line: string) => void) | null = null;
  const sent: string[] = [];
  const transport: CodexTransport = {
    send(message) {
      sent.push(message);
    },
    onMessage(handler) {
      messageHandler = handler;
      return () => {
        if (messageHandler === handler) messageHandler = null;
      };
    },
    async close() {
      messageHandler = null;
    },
  };
  return {
    transport,
    sent,
    emit(line: string) {
      if (!messageHandler) throw new Error('no message handler attached');
      messageHandler(line);
    },
    /** Wait one microtask so client-side promise wiring settles. */
    flush: () => new Promise<void>((r) => setImmediate(r)),
  };
}

describe('CodexAppServerClient — initialize handshake', () => {
  it('sends initialize with client name + version, then initialized notification', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '1.2.3' });

    const promise = client.initialize();
    await mock.flush();
    const initReq = JSON.parse(mock.sent[0]);
    assert.equal(initReq.jsonrpc, '2.0');
    assert.equal(initReq.method, 'initialize');
    assert.equal(initReq.params.clientInfo.name, CODEX_CLIENT_NAME);
    assert.equal(initReq.params.clientInfo.version, '1.2.3');
    assert.equal(typeof initReq.id, 'number');

    // Server responds
    mock.emit(JSON.stringify({
      jsonrpc: '2.0',
      id: initReq.id,
      result: {
        userAgent: 'codex/0.50.0',
        codexHome: '/home/test/.codex',
        platformFamily: 'unix',
        platformOs: 'macos',
      },
    }));

    const result = await promise;
    assert.equal(result.userAgent, 'codex/0.50.0');
    assert.equal(result.codexHome, '/home/test/.codex');

    // Initialized notification fired
    await mock.flush();
    const notif = JSON.parse(mock.sent[1]);
    assert.equal(notif.method, 'initialized');
    assert.equal(notif.id, undefined);
    assert.equal(client.initialized, true);

    await client.dispose();
  });
});

describe('CodexAppServerClient — request / response', () => {
  it('resolves a typed request with the server result', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    const promise = client.request<{ ok: true }>('model/list', { includeHidden: false });
    await mock.flush();
    const sent = JSON.parse(mock.sent[0]);
    assert.equal(sent.method, 'model/list');
    assert.equal(sent.params.includeHidden, false);
    mock.emit(JSON.stringify({ id: sent.id, result: { ok: true } }));
    const result = await promise;
    assert.deepEqual(result, { ok: true });
    await client.dispose();
  });

  it('rejects with CodexRpcError on error response, preserving code + data', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    const promise = client.request('unknown/method');
    await mock.flush();
    const sent = JSON.parse(mock.sent[0]);
    mock.emit(JSON.stringify({
      id: sent.id,
      error: { code: -32601, message: 'Method not found', data: { hint: 'check spelling' } },
    }));
    await assert.rejects(promise, (err: unknown) => {
      assert.ok(err instanceof CodexRpcError);
      assert.equal((err as CodexRpcError).code, -32601);
      assert.equal((err as CodexRpcError).message, 'Method not found');
      assert.deepEqual((err as CodexRpcError).data, { hint: 'check spelling' });
      return true;
    });
    await client.dispose();
  });

  it('retries -32001 overloaded up to maxOverloadRetries, then surfaces the error', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, {
      version: '0.0.0',
      maxOverloadRetries: 2,
      requestTimeoutMs: 0,
    });
    const promise = client.request('thread/start', { cwd: '/tmp' });

    for (let attempt = 0; attempt < 3; attempt++) {
      // Each attempt: drain the queue, emit overload response.
      // Use polling because between attempts the client schedules a
      // backoff via setTimeout.
       
      while (mock.sent.length <= attempt) {
         
        await new Promise((r) => setTimeout(r, 10));
      }
      const sent = JSON.parse(mock.sent[attempt]);
      mock.emit(JSON.stringify({
        id: sent.id,
        error: { code: JSON_RPC_OVERLOADED_CODE, message: 'Server overloaded; retry later.' },
      }));
    }

    await assert.rejects(promise, (err: unknown) => err instanceof CodexRpcError && (err as CodexRpcError).code === JSON_RPC_OVERLOADED_CODE);
    // 1 initial + 2 retries = 3 sends
    assert.equal(mock.sent.length, 3);
    await client.dispose();
  });
});

describe('CodexAppServerClient — notifications', () => {
  it('routes notifications by method to registered handlers', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0' });
    // Force attach without initialize
    const deltas: unknown[] = [];
    const unsub = client.onNotification('item/agentMessage/delta', (params) => deltas.push(params));
    // Manually attach via a no-op request prepares the listener. We
    // can use notify() to attach since it lazily attaches the
    // transport listener.
    await client.notify('initialized', {});

    mock.emit(JSON.stringify({
      method: 'item/agentMessage/delta',
      params: { threadId: 't1', turnId: 'u1', itemId: 'm1', delta: 'hello' },
    }));

    assert.equal(deltas.length, 1);
    assert.deepEqual(deltas[0], { threadId: 't1', turnId: 'u1', itemId: 'm1', delta: 'hello' });

    unsub();
    mock.emit(JSON.stringify({
      method: 'item/agentMessage/delta',
      params: { threadId: 't1', turnId: 'u1', itemId: 'm2', delta: 'world' },
    }));
    // No new delivery after unsubscribe.
    assert.equal(deltas.length, 1);
    await client.dispose();
  });
});

describe('CodexAppServerClient — dispose', () => {
  it('rejects pending requests on dispose so callers do not hang', async () => {
    const mock = makeMockTransport();
    const client = new CodexAppServerClient(mock.transport, { version: '0.0.0', requestTimeoutMs: 0 });
    const promise = client.request('thread/start');
    await mock.flush();
    await client.dispose();
    await assert.rejects(promise, /aborted.*disposed/);
  });
});
