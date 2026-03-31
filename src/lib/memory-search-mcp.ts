/**
 * codepilot-memory MCP — in-process MCP server for memory search/retrieval.
 *
 * Provides 2 tools:
 * - codepilot_memory_search: Search workspace memory files with temporal decay
 * - codepilot_memory_get: Read a specific file from the assistant workspace
 *
 * Always-on in assistant mode (not keyword-gated).
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import type { SearchResult } from '@/types';

const HALF_LIFE_DAYS = 30;
const LAMBDA = Math.log(2) / HALF_LIFE_DAYS;
const MAX_SNIPPET_CHARS = 3000;

export const MEMORY_SEARCH_SYSTEM_PROMPT = `## 记忆检索

在回答任何关于过去工作、决策、日期、人物、偏好或待办的问题前：
1. 先用 codepilot_memory_search 搜索相关记忆
2. 如果搜到相关结果，用 codepilot_memory_get 获取详细内容
3. 如果搜索后仍不确定，告知用户你已检查但未找到相关记录

不要凭记忆猜测过去发生的事，始终先搜索再回答。`;

export function createMemorySearchMcpServer(workspacePath: string) {
  return createSdkMcpServer({
    name: 'codepilot-memory',
    version: '1.0.0',
    tools: [
      tool(
        'codepilot_memory_search',
        'Search assistant workspace memory files (memory.md, daily memories, workspace docs). Use before answering questions about past work, decisions, dates, people, preferences, or todos.',
        {
          query: z.string().describe('Search keywords'),
          limit: z.number().optional().default(5).describe('Max number of results'),
        },
        async ({ query, limit }) => {
          try {
            // Dynamic import to avoid circular deps
            const { searchWorkspace } = await import('./workspace-retrieval');
            const results = searchWorkspace(workspacePath, query, { limit: limit || 5 });

            // Apply temporal decay to dated files
            const decayed = applyTemporalDecay(results);

            if (decayed.length === 0) {
              return { content: [{ type: 'text' as const, text: 'No matching memories found.' }] };
            }

            const formatted = decayed.map((r, i) =>
              `${i + 1}. [${r.path}] (score: ${r.score.toFixed(2)})\n   ${r.heading || ''}\n   ${(r.snippet || '').slice(0, 200)}`
            ).join('\n\n');

            return { content: [{ type: 'text' as const, text: formatted }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Search failed: ${err instanceof Error ? err.message : 'unknown error'}` }] };
          }
        },
      ),

      tool(
        'codepilot_memory_get',
        'Read a specific file from the assistant workspace. Use after memory_search finds relevant files. Paths must be relative to the workspace root.',
        {
          file_path: z.string().describe('File path relative to workspace root (e.g. "memory.md", "memory/daily/2026-03-30.md")'),
          line_start: z.number().optional().describe('Start line number (1-based)'),
          line_end: z.number().optional().describe('End line number (inclusive)'),
        },
        async ({ file_path, line_start, line_end }) => {
          // Security: resolve and check path is within workspace
          const resolved = path.resolve(workspacePath, file_path);
          if (!resolved.startsWith(path.resolve(workspacePath))) {
            return { content: [{ type: 'text' as const, text: 'Access denied: path is outside workspace.' }] };
          }

          try {
            if (!fs.existsSync(resolved)) {
              return { content: [{ type: 'text' as const, text: `File not found: ${file_path}` }] };
            }

            let content = fs.readFileSync(resolved, 'utf-8');

            // Optional line range
            if (line_start || line_end) {
              const lines = content.split('\n');
              const start = Math.max(0, (line_start || 1) - 1);
              const end = Math.min(lines.length, line_end || lines.length);
              content = lines.slice(start, end).join('\n');
            }

            // Truncate to MAX_SNIPPET_CHARS
            if (content.length > MAX_SNIPPET_CHARS) {
              content = content.slice(0, MAX_SNIPPET_CHARS) + '\n\n[...truncated...]';
            }

            return { content: [{ type: 'text' as const, text: content || '(empty file)' }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Read failed: ${err instanceof Error ? err.message : 'unknown error'}` }] };
          }
        },
      ),
    ],
  });
}

/**
 * Apply temporal decay to search results.
 * Dated files (memory/daily/YYYY-MM-DD.md) get exponential decay.
 * Evergreen files (MEMORY.md, README.ai.md, undated files) are not decayed.
 */
function applyTemporalDecay(results: SearchResult[]): SearchResult[] {
  const now = Date.now();
  return results.map(r => {
    const dateMatch = r.path.match(/(\d{4}-\d{2}-\d{2})\.md$/);
    if (!dateMatch) return r; // Evergreen file — no decay

    const fileDate = new Date(dateMatch[1]).getTime();
    if (isNaN(fileDate)) return r;

    const ageInDays = (now - fileDate) / (24 * 60 * 60 * 1000);
    if (ageInDays <= 0) return r; // Future or today — no decay

    const decayFactor = Math.exp(-LAMBDA * ageInDays);
    return { ...r, score: r.score * decayFactor };
  }).sort((a, b) => b.score - a.score);
}
