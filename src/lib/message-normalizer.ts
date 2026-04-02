/**
 * Message Normalizer — shared message content cleaning for fallback and compression.
 *
 * Strips internal metadata and normalizes structured assistant messages
 * into readable text. Used by both buildFallbackContext (claude-client.ts)
 * and compressConversation (context-compressor.ts).
 */

/**
 * Normalize a single message for context injection or compression.
 * - Strips internal file attachment metadata (<!--files:...-->)
 * - Extracts text + tool summaries from assistant JSON messages
 */
export function normalizeMessageContent(role: string, raw: string): string {
  // Strip internal file attachment metadata
  let content = raw.replace(/<!--files:[\s\S]*?-->/g, '');

  // For assistant messages with structured content (JSON arrays),
  // extract text + brief tool summaries instead of dropping tools entirely.
  if (role === 'assistant' && content.startsWith('[')) {
    try {
      const blocks = JSON.parse(content);
      const parts: string[] = [];
      for (const b of blocks) {
        if (b.type === 'text' && b.text) {
          parts.push(b.text);
        } else if (b.type === 'tool_use') {
          // Keep a brief summary of tool usage (name + truncated input)
          const name = b.name || 'unknown_tool';
          const inputStr = typeof b.input === 'object' ? JSON.stringify(b.input) : String(b.input || '');
          const truncated = inputStr.length > 80 ? inputStr.slice(0, 80) + '...' : inputStr;
          parts.push(`(used ${name}: ${truncated})`);
        }
        // tool_result blocks are skipped — the summary above captures intent
      }
      content = parts.length > 0 ? parts.join('\n') : '(assistant used tools)';
    } catch {
      // Not JSON, use as-is
    }
  }
  return content;
}
