/**
 * Phase 5b — Codex proxy tool contract test.
 *
 * Pins the AI SDK v6 schema contract: tools coming out of
 * `translateResponsesTools` must be the actual `tool({ inputSchema:
 * jsonSchema(...) })` wrapper, NOT a raw `{ description, inputSchema }`
 * object force-cast to ai-sdk's Tool type.
 *
 * Why a separate test file: codex-proxy-translators.test.ts pins
 * SHAPE (description / inputSchema presence). That's not enough —
 * the pre-fix code passed shape but the runtime contract (`asSchema`
 * calls `.validate(...)` on the wrapper, raw objects don't have
 * `.validate`, schema-is-not-a-function explodes inside streamText)
 * still tripped. The fix here is to drive `streamText` end-to-end
 * with a `MockLanguageModelV3` and assert it sees the function tool
 * arriving as a valid provider-format `LanguageModelV3FunctionTool`.
 *
 * Lifecycle:
 *   1. Build a synthetic ResponsesTool[] (function tool with a real
 *      JSON Schema body, plus a non-function entry filtered upstream).
 *   2. translateResponsesTools → ToolSet.
 *   3. streamText({ model: mock, tools, prompt }) → drain the stream.
 *   4. Inspect mock.doStreamCalls[0].tools — must be the
 *      ai-sdk-normalised function tool with inputSchema as a real
 *      JSON Schema object (the wrapper having been unpacked by
 *      ai-sdk before the model call).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { streamText, jsonSchema, tool, type ToolSet } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { translateResponsesTools } from '@/lib/codex/proxy/translate-tools';
import type { ResponsesTool } from '@/lib/codex/proxy/types';

/**
 * Build a MockLanguageModelV3 whose doStream returns a minimal
 * "text-delta + finish" stream. Captures the call options so we can
 * assert on tools / prompt shape after streaming.
 */
function makeMock() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'response-metadata', id: 't1', modelId: 'test', timestamp: new Date(0) });
          controller.enqueue({ type: 'text-start', id: 'msg-1' });
          controller.enqueue({ type: 'text-delta', id: 'msg-1', delta: 'ok' });
          controller.enqueue({ type: 'text-end', id: 'msg-1' });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          });
          controller.close();
        },
      }),
    }),
  });
}

async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const part of stream) out.push(part);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// The actual contract — streamText must accept the translated tools
// ─────────────────────────────────────────────────────────────────────

describe('translateResponsesTools — AI SDK v6 wrapper contract (Phase 5b smoke round 3)', () => {
  it('streamText accepts the translated function tool without "schema is not a function"', async () => {
    const tools = translateResponsesTools([
      {
        type: 'function',
        name: 'lookup',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
          additionalProperties: false,
        },
      },
    ]);
    assert.ok(tools, 'translator must produce a ToolSet for a single function tool');

    const mock = makeMock();
    // The pre-fix code force-cast `{ description, inputSchema }` into
    // ai-sdk's Tool type. ai-sdk's asSchema() helper invoked
    // schema.validate(...) on the wrapper internally, and a raw
    // object had no `.validate` → "schema is not a function". The
    // POST-fix code goes through `tool({ inputSchema: jsonSchema(...) })`
    // which produces a wrapper with the required hooks. If the fix
    // regresses, this stream call will throw before doStream runs.
    const result = streamText({
      model: mock,
      tools: tools as unknown as ToolSet,
      prompt: 'hi',
    });
    const parts = await drain(result.fullStream);
    // We don't care what the assistant said; we care that streamText
    // didn't throw setting up the tool schema. Sanity-check we got
    // text-delta(s) and a finish event so the stream actually ran.
    const types = parts.map(p => (p as { type: string }).type);
    assert.ok(types.includes('text-delta'), `expected a text-delta event but got types: ${types.join(', ')}`);
    assert.ok(types.includes('finish'), `expected a finish event but got types: ${types.join(', ')}`);
  });

  it('mock LanguageModel receives the function tool in provider format with JSON schema unpacked', async () => {
    const tools = translateResponsesTools([
      {
        type: 'function',
        name: 'add',
        description: 'Add two integers',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
      },
    ]);
    const mock = makeMock();
    const result = streamText({
      model: mock,
      tools: tools as unknown as ToolSet,
      prompt: 'sum',
    });
    await drain(result.fullStream);

    // ai-sdk maps our wrapper into LanguageModelV3FunctionTool before
    // calling doStream. The provider-format expects
    //   { type: 'function', name, description, inputSchema: <JSONSchema7> }
    // with `inputSchema` as a real JSON Schema object (NOT the
    // ai-sdk wrapper). If our translator emitted a raw object,
    // ai-sdk would have failed before reaching the mock.
    assert.equal(mock.doStreamCalls.length, 1, 'doStream must have been invoked once');
    const call = mock.doStreamCalls[0];
    assert.ok(Array.isArray(call.tools), 'call.tools must be an array');
    const fn = (call.tools as Array<{ type: string; name: string; inputSchema?: unknown }>)[0];
    assert.equal(fn.type, 'function');
    assert.equal(fn.name, 'add');
    assert.ok(fn.inputSchema && typeof fn.inputSchema === 'object', 'inputSchema must be present');
    const schema = fn.inputSchema as { type?: string; properties?: { a?: { type: string }; b?: { type: string } } };
    assert.equal(schema.type, 'object', 'wrapper must unpack to a real JSON Schema object');
    assert.equal(schema.properties?.a?.type, 'number', 'nested schema fields must round-trip');
    assert.equal(schema.properties?.b?.type, 'number');
  });

  it('synthesised empty-object schema (when Codex sends a parameterless function tool) still passes the wrapper contract', async () => {
    const tools = translateResponsesTools([
      { type: 'function', name: 'no_args' },
    ]);
    const mock = makeMock();
    const result = streamText({
      model: mock,
      tools: tools as unknown as ToolSet,
      prompt: 'go',
    });
    await drain(result.fullStream);
    const fn = (mock.doStreamCalls[0].tools as Array<{ inputSchema: { type?: string; properties?: object } }>)[0];
    assert.equal(fn.inputSchema.type, 'object');
    assert.deepEqual(fn.inputSchema.properties, {});
  });

  it('forwards `strict: true` through to the provider-format tool', async () => {
    // Phase 5b smoke round 4 (2026-05-16). Parser preserves
    // tool.strict; translator now forwards it via ai-sdk's tool()
    // helper so providers that honour strict mode (OpenAI structured
    // outputs etc.) actually see it on the provider-format call.
    // Pre-fix the field was silently dropped and the model behaved
    // as non-strict, which can change tool-call validity without
    // surfacing the divergence to the user.
    const tools = translateResponsesTools([
      {
        type: 'function',
        name: 'structured',
        description: 'Return JSON',
        strict: true,
        parameters: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false,
        },
      },
    ]);
    const mock = makeMock();
    const result = streamText({
      model: mock,
      tools: tools as unknown as ToolSet,
      prompt: 'go',
    });
    await drain(result.fullStream);
    const fn = (mock.doStreamCalls[0].tools as Array<{ name: string; strict?: boolean }>)[0];
    assert.equal(fn.name, 'structured');
    assert.equal(fn.strict, true, 'tool.strict must flow through translator → ai-sdk tool() → provider-format strict field');
  });

  it('omits `strict` when Codex did NOT declare it (no defaulting)', async () => {
    // Symmetric pin: a missing strict must stay missing. ai-sdk
    // treats `undefined` as "don't override the provider default";
    // forcing `false` would actively disable strict mode for
    // providers that default to it.
    const tools = translateResponsesTools([
      { type: 'function', name: 'no_strict', description: 'plain' },
    ]);
    const mock = makeMock();
    const result = streamText({
      model: mock,
      tools: tools as unknown as ToolSet,
      prompt: 'go',
    });
    await drain(result.fullStream);
    const fn = (mock.doStreamCalls[0].tools as Array<{ strict?: boolean }>)[0];
    assert.equal(fn.strict, undefined, 'omitted strict must remain undefined — do not synthesise a default');
  });

  it('canonical tool() + jsonSchema() shape matches the translator output (sanity guard)', () => {
    // Direct comparison: build the same tool via ai-sdk's helpers
    // and via the translator; both shapes must be assignable to the
    // same Tool type. If a future ai-sdk version changes the wrapper
    // interface, this catches the drift before streamText runtime.
    const viaHelper = {
      add: tool({
        description: 'Add',
        inputSchema: jsonSchema({
          type: 'object',
          properties: { a: { type: 'number' } },
        }),
      }),
    };
    const viaTranslator = translateResponsesTools([
      {
        type: 'function',
        name: 'add',
        description: 'Add',
        parameters: {
          type: 'object',
          properties: { a: { type: 'number' } },
        },
      },
    ]);
    assert.ok(viaTranslator);
    // Same shape of keys / same wrapper marker so ai-sdk's asSchema()
    // accepts both equally.
    const a = viaHelper.add as Record<string, unknown>;
    const b = viaTranslator!.add as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  });
});
