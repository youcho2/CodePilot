/**
 * Phase 5b — Codex Responses proxy: incoming request parser.
 *
 * Codex sends a JSON POST to `/api/codex/proxy/v1/responses` shaped
 * like OpenAI's Responses-API. The parser does shape validation only
 * — semantic checks (does the targeted provider exist, do we have
 * credentials etc.) happen later in the adapter so a structured
 * error can name the actual cause.
 *
 * Validation philosophy: lenient on optional fields, strict on the
 * three load-bearing ones (`model`, `input`, item shape). Anything
 * missing surfaces as `invalid_request` with a sentence naming the
 * field — Codex's reader displays the message verbatim.
 */

import type {
  ResponsesContentBlock,
  ResponsesInputItem,
  ResponsesRequestBody,
  ResponsesTool,
} from './types';

export type ParseResult =
  | { ok: true; body: ResponsesRequestBody }
  | { ok: false; message: string; field?: string };

export function parseResponsesRequest(raw: unknown): ParseResult {
  if (!isObject(raw)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }

  const model = raw.model;
  if (typeof model !== 'string' || model.length === 0) {
    return { ok: false, field: 'model', message: 'Request must include a non-empty `model` string.' };
  }

  const input = raw.input;
  if (!Array.isArray(input)) {
    return { ok: false, field: 'input', message: 'Request must include `input` as an array of items.' };
  }

  const parsedInput: ResponsesInputItem[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (!isObject(item)) {
      return { ok: false, field: `input[${i}]`, message: `Input item ${i} must be a JSON object.` };
    }
    const itemType = item.type;
    if (itemType === 'message') {
      const role = item.role;
      if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'developer') {
        return { ok: false, field: `input[${i}].role`, message: `Item ${i} role must be user / assistant / system / developer.` };
      }
      const content = item.content;
      if (!Array.isArray(content)) {
        return { ok: false, field: `input[${i}].content`, message: `Item ${i} content must be an array.` };
      }
      const blocks: ResponsesContentBlock[] = [];
      for (let j = 0; j < content.length; j++) {
        const block = content[j];
        if (!isObject(block)) {
          return { ok: false, field: `input[${i}].content[${j}]`, message: `Content block ${j} must be a JSON object.` };
        }
        const blockType = block.type;
        if (blockType === 'input_text' || blockType === 'output_text') {
          if (typeof block.text !== 'string') {
            return { ok: false, field: `input[${i}].content[${j}].text`, message: `Content block ${j} must include text:string.` };
          }
          blocks.push({ type: blockType, text: block.text });
        } else if (blockType === 'input_image') {
          if (typeof block.image_url !== 'string') {
            return { ok: false, field: `input[${i}].content[${j}].image_url`, message: `Content block ${j} (input_image) must include image_url:string.` };
          }
          blocks.push({ type: 'input_image', image_url: block.image_url });
        } else {
          return { ok: false, field: `input[${i}].content[${j}].type`, message: `Content block ${j} has unsupported type "${String(blockType)}".` };
        }
      }
      parsedInput.push({ type: 'message', role, content: blocks });
    } else if (itemType === 'function_call') {
      if (typeof item.call_id !== 'string') {
        return { ok: false, field: `input[${i}].call_id`, message: `function_call item ${i} must include call_id:string.` };
      }
      if (typeof item.name !== 'string') {
        return { ok: false, field: `input[${i}].name`, message: `function_call item ${i} must include name:string.` };
      }
      if (typeof item.arguments !== 'string') {
        return { ok: false, field: `input[${i}].arguments`, message: `function_call item ${i} arguments must be a JSON-encoded string.` };
      }
      parsedInput.push({ type: 'function_call', call_id: item.call_id, name: item.name, arguments: item.arguments });
    } else if (itemType === 'function_call_output') {
      if (typeof item.call_id !== 'string') {
        return { ok: false, field: `input[${i}].call_id`, message: `function_call_output item ${i} must include call_id:string.` };
      }
      if (typeof item.output !== 'string') {
        return { ok: false, field: `input[${i}].output`, message: `function_call_output item ${i} output must be a string.` };
      }
      parsedInput.push({ type: 'function_call_output', call_id: item.call_id, output: item.output });
    } else {
      return { ok: false, field: `input[${i}].type`, message: `Input item ${i} has unsupported type "${String(itemType)}".` };
    }
  }

  let tools: ResponsesTool[] | undefined;
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      return { ok: false, field: 'tools', message: 'tools must be an array.' };
    }
    tools = [];
    for (let i = 0; i < raw.tools.length; i++) {
      const tool = raw.tools[i];
      if (!isObject(tool)) {
        return { ok: false, field: `tools[${i}]`, message: `tools[${i}] must be a JSON object.` };
      }
      // Phase 5b smoke fix (2026-05-15) — Codex's real `turn/start`
      // payload mixes function tools with Codex-specific entries like
      // `{ type: 'custom', ... }` (Codex's own apply_patch / shell
      // surface). Pre-fix we returned a 400 here, which blocked every
      // real Codex chat that used non-trivial tools. Phase 5b's scope
      // is chat parity, NOT a full Codex custom-tool bridge — so we
      // silently DROP non-function tools rather than failing. They're
      // re-added later when CodePilot grows a matching tool runtime.
      if (tool.type !== 'function') {
        // Drop, don't reject. The unified translator only emits the
        // function tools to ai-sdk; the rest are invisible to the
        // model and to the upstream provider.
        continue;
      }
      if (typeof tool.name !== 'string') {
        return { ok: false, field: `tools[${i}].name`, message: `tools[${i}].name must be a string.` };
      }
      const parameters = isObject(tool.parameters) ? tool.parameters : undefined;
      tools.push({
        type: 'function',
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : undefined,
        parameters,
        strict: typeof tool.strict === 'boolean' ? tool.strict : undefined,
      });
    }
    // Treat "empty after filtering" as "no tools" so the adapter omits
    // the field entirely (ai-sdk distinguishes undefined from []).
    if (tools.length === 0) tools = undefined;
  }

  const stream = raw.stream === undefined ? true : !!raw.stream;
  const instructions = typeof raw.instructions === 'string' ? raw.instructions : undefined;
  const metadata = isObject(raw.metadata) ? raw.metadata : undefined;
  const reasoning = isObject(raw.reasoning)
    ? { effort: typeof raw.reasoning.effort === 'string' ? (raw.reasoning.effort as ResponsesRequestBody['reasoning'] extends infer R ? R extends { effort?: infer E } ? E : never : never) : undefined }
    : undefined;
  // Phase 5b smoke fix (2026-05-15) — OpenAI OAuth (Codex API)
  // requires `store: false` on outbound /responses calls. Codex
  // itself sends `store: false` in its request body; we MUST preserve
  // that and forward it via providerOptions.openai.store. Pre-fix
  // we dropped the field on parse, so even when Codex (or a manual
  // smoke) explicitly sent store:false the upstream still rejected
  // with "Store must be set to false". Accept a boolean and let the
  // adapter decide what to do with it.
  const store = typeof raw.store === 'boolean' ? raw.store : undefined;

  return {
    ok: true,
    body: {
      model,
      input: parsedInput,
      ...(tools ? { tools } : {}),
      stream,
      ...(instructions ? { instructions } : {}),
      ...(metadata ? { metadata } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(store !== undefined ? { store } : {}),
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
