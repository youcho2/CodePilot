import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline simplified logic — no imports from src/lib
// ---------------------------------------------------------------------------

function shouldAppendPrompt(
  historyMessages: Array<{ role: string; content: unknown }>,
  autoTrigger: boolean,
): boolean {
  if (autoTrigger) return true;
  if (historyMessages.length === 0) return true;
  if (historyMessages[historyMessages.length - 1]?.role !== 'user') return true;
  return false;
}

function mergeUserContent(a: unknown, b: unknown): unknown {
  const norm = (v: unknown) =>
    typeof v === 'string'
      ? [{ type: 'text', text: v }]
      : Array.isArray(v)
        ? v
        : [{ type: 'text', text: String(v) }];
  const merged = [...norm(a), ...norm(b)];
  if (merged.every((p: { type: string }) => p.type === 'text'))
    return merged
      .map((p: { text?: string }) => p.text || '')
      .join('\n\n')
      .trim();
  return merged;
}

function buildUserMessage(
  content: string,
): { role: string; content: unknown } {
  const match = content.match(/^<!--files:(\[.*?\])-->([\s\S]*)$/);
  if (!match) return { role: 'user', content };
  const text = match[2] || '';
  let files: Array<{ name: string; type: string; filePath?: string }> = [];
  try {
    files = JSON.parse(match[1]);
  } catch {
    /* ignore */
  }
  if (files.length === 0) return { role: 'user', content: text };
  const parts: Array<{
    type: string;
    text?: string;
    data?: string;
    mediaType?: string;
  }> = [];
  if (text.trim()) parts.push({ type: 'text', text: text.trim() });
  for (const f of files) {
    if (f.type?.startsWith('image/')) {
      parts.push({ type: 'file', data: 'base64data', mediaType: f.type });
    } else {
      parts.push({ type: 'text', text: `[File: ${f.name}]` });
    }
  }
  if (parts.length === 1 && parts[0].type === 'text')
    return { role: 'user', content: parts[0].text };
  return { role: 'user', content: parts };
}

// ---------------------------------------------------------------------------
// Suite 1: shouldAppendPrompt
// ---------------------------------------------------------------------------

describe('shouldAppendPrompt', () => {
  it('returns false when last message is user (normal message already in DB)', () => {
    const history = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'follow-up' },
    ];
    assert.equal(shouldAppendPrompt(history, false), false);
  });

  it('returns true when autoTrigger is set, even if last is user', () => {
    const history = [{ role: 'user', content: 'hello' }];
    assert.equal(shouldAppendPrompt(history, true), true);
  });

  it('returns true when history is empty', () => {
    assert.equal(shouldAppendPrompt([], false), true);
  });

  it('returns true when last message is assistant', () => {
    const history = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    assert.equal(shouldAppendPrompt(history, false), true);
  });

  it('returns false when last is user with multipart content array (role check only)', () => {
    const history = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image', data: 'base64...' },
        ],
      },
    ];
    assert.equal(shouldAppendPrompt(history, false), false);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: mergeUserContent
// ---------------------------------------------------------------------------

describe('mergeUserContent', () => {
  it('merges string + string into a single joined string', () => {
    const result = mergeUserContent('hello', 'world');
    assert.equal(typeof result, 'string');
    assert.equal(result, 'hello\n\nworld');
  });

  it('returns array when string + multipart with file part', () => {
    const filePart = { type: 'file', data: 'abc123', mediaType: 'image/png' };
    const result = mergeUserContent('describe this', [filePart]);
    assert.ok(Array.isArray(result));
    const arr = result as Array<{ type: string }>;
    assert.equal(arr.length, 2);
    assert.equal(arr[0].type, 'text');
    assert.equal(arr[1].type, 'file');
  });

  it('combines multipart + multipart into a single array', () => {
    const a = [{ type: 'text', text: 'part A' }];
    const b = [{ type: 'image', data: 'img' }];
    const result = mergeUserContent(a, b);
    assert.ok(Array.isArray(result));
    assert.equal((result as unknown[]).length, 2);
  });

  it('collapses all-text parts into a single string', () => {
    const a = [{ type: 'text', text: 'one' }];
    const b = [{ type: 'text', text: 'two' }];
    const result = mergeUserContent(a, b);
    assert.equal(typeof result, 'string');
    assert.equal(result, 'one\n\ntwo');
  });
});

// ---------------------------------------------------------------------------
// Suite 3: buildUserMessage
// ---------------------------------------------------------------------------

describe('buildUserMessage', () => {
  it('returns plain string content for text without files prefix', () => {
    const msg = buildUserMessage('just a question');
    assert.equal(msg.role, 'user');
    assert.equal(msg.content, 'just a question');
  });

  it('returns multipart with file part for image attachment', () => {
    const raw =
      '<!--files:[{"name":"photo.png","type":"image/png","filePath":"/tmp/photo.png"}]-->describe this';
    const msg = buildUserMessage(raw);
    assert.equal(msg.role, 'user');
    assert.ok(Array.isArray(msg.content));
    const parts = msg.content as Array<{
      type: string;
      text?: string;
      data?: string;
      mediaType?: string;
    }>;
    assert.equal(parts.length, 2);
    assert.equal(parts[0].type, 'text');
    assert.equal(parts[0].text, 'describe this');
    assert.equal(parts[1].type, 'file');
    assert.equal(parts[1].mediaType, 'image/png');
  });

  it('adds text placeholder for non-image file', () => {
    const raw =
      '<!--files:[{"name":"report.pdf","type":"application/pdf"}]-->review this';
    const msg = buildUserMessage(raw);
    assert.ok(Array.isArray(msg.content));
    const parts = msg.content as Array<{ type: string; text?: string }>;
    const filePart = parts.find((p) => p.text?.includes('[File:'));
    assert.ok(filePart);
    assert.ok(filePart!.text!.includes('report.pdf'));
  });

  it('returns just text content when files array is empty', () => {
    const raw = '<!--files:[]-->some text';
    const msg = buildUserMessage(raw);
    assert.equal(msg.role, 'user');
    assert.equal(msg.content, 'some text');
  });

  it('returns plain string when input has no <!--files: prefix', () => {
    const raw = 'no special prefix here';
    const msg = buildUserMessage(raw);
    assert.equal(msg.role, 'user');
    assert.equal(typeof msg.content, 'string');
    assert.equal(msg.content, 'no special prefix here');
  });
});
