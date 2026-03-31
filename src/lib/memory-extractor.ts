/**
 * Memory Extractor — automatically extracts memorable information from conversations.
 *
 * Inspired by Claude Code's extractMemories service (forked agent pattern).
 * We can't fork agents (SDK limitation), so we use generateTextFromProvider instead.
 *
 * Runs every 3 turns in assistant project sessions. Skips if the AI already
 * wrote to memory files in this turn (mutual exclusion like Claude Code's hasMemoryWritesSince).
 */

const EXTRACTION_INTERVAL = 3; // Extract every 3 turns
const GLOBAL_KEY = '__memory_extraction_counter__';

/**
 * Check if memory extraction should run for this turn.
 * Returns true every EXTRACTION_INTERVAL assistant turns.
 */
export function shouldExtractMemory(): boolean {
  const counter = ((globalThis as Record<string, unknown>)[GLOBAL_KEY] as number) || 0;
  const next = counter + 1;
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = next;
  return next % EXTRACTION_INTERVAL === 0;
}

/**
 * Reset the extraction counter (e.g., on session change).
 */
export function resetExtractionCounter(): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = 0;
}

/**
 * Check if the AI already wrote to memory files in this turn.
 * Looks for write/edit tool calls targeting memory paths.
 */
export function hasMemoryWritesInResponse(responseText: string): boolean {
  // Check for tool_use blocks that wrote to memory files
  const memoryPathPatterns = [
    /memory\.md/i,
    /memory\/daily\//,
    /soul\.md/i,
    /user\.md/i,
  ];
  // Look for Write/Edit tool calls with memory paths
  if (responseText.includes('tool_use') || responseText.includes('tool_result')) {
    return memoryPathPatterns.some(p => p.test(responseText));
  }
  return false;
}

/**
 * Extract memorable information from recent conversation messages.
 * Uses a lightweight LLM call (not full streaming).
 */
export async function extractMemories(
  recentMessages: Array<{ role: string; content: string }>,
  workspacePath: string,
): Promise<void> {
  if (recentMessages.length < 2) return;

  try {
    const { generateTextFromProvider } = await import('./text-generator');
    const { resolveProvider } = await import('./provider-resolver');
    const resolved = resolveProvider({ useCase: 'small' });

    if (!resolved.hasCredentials) return;

    // Take last 3 turns (6 messages max)
    const context = recentMessages.slice(-6).map(m =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 500)}`
    ).join('\n\n');

    const result = await generateTextFromProvider({
      providerId: resolved.provider?.id || '',
      model: resolved.upstreamModel || resolved.model || 'haiku',
      system: 'You extract durable memories from conversations. Only extract information worth remembering long-term: decisions, preferences, important facts, commitments, deadlines. NOT transient details or small talk.',
      prompt: `Review this conversation excerpt and extract any durable memories worth saving.

${context}

If there are memories worth saving, output them as a markdown list:
- Memory 1
- Memory 2

If nothing is worth remembering, output exactly: NOTHING`,
      maxTokens: 300,
    });

    if (!result || result.trim() === 'NOTHING' || result.trim().length < 10) return;

    // Write to daily memory
    const fs = await import('fs');
    const path = await import('path');
    const { getLocalDateString } = await import('@/lib/utils');
    const today = getLocalDateString();
    const dailyDir = path.join(workspacePath, 'memory', 'daily');

    if (!fs.existsSync(dailyDir)) {
      fs.mkdirSync(dailyDir, { recursive: true });
    }

    const dailyPath = path.join(dailyDir, `${today}.md`);
    const separator = fs.existsSync(dailyPath) ? '\n\n---\n\n' : '';
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    fs.appendFileSync(dailyPath, `${separator}## Auto-extracted (${timestamp})\n${result.trim()}\n`, 'utf-8');

    console.log(`[memory-extractor] Extracted memories to ${dailyPath}`);
  } catch (err) {
    console.error('[memory-extractor] Extraction failed:', err);
  }
}
