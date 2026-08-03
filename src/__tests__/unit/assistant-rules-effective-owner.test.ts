import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf-8');

describe('assistant rules effective injection owner', () => {
  it('interactive and bridge callers hand env Claude SDK project rules to the SDK', () => {
    const chat = read('src/app/api/chat/route.ts');
    const bridge = read('src/lib/bridge/conversation-engine.ts');
    for (const source of [chat, bridge]) {
      assert.match(source, /claudeSdkOwnsProjectRules/);
      assert.match(source, /=== ['"]claude_code['"]\s*&&\s*!resolved\.provider/);
    }
  });

  it('Context Assembler omits only a natively discoverable CLAUDE.md', () => {
    const source = read('src/lib/context-assembler.ts');
    assert.match(source, /claudeSdkOwnsProjectRules === true && files\.rulesFileNativeClaude === true/);
  });

  it('heartbeat SDK calls keep settingSources empty', () => {
    const source = read('src/lib/claude-client.ts');
    assert.match(source, /settingSources:\s*isHeartbeatMode\s*\?\s*\(\[\]/);
  });
});
