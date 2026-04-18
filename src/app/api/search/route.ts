import { NextRequest } from 'next/server';
import { getAllSessions, searchMessages } from '@/lib/db';
import { scanDirectory } from '@/lib/files';
import type { ChatSession, FileTreeNode } from '@/types';

const FILE_SCAN_DEPTH = 2;
const MAX_RESULTS_PER_TYPE = 10;

interface SearchResultSession {
  type: 'session';
  id: string;
  title: string;
  projectName: string;
  updatedAt: string;
}

interface SearchResultMessage {
  type: 'message';
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  role: 'user' | 'assistant';
  snippet: string;
  createdAt: string;
  contentType: 'user' | 'assistant' | 'tool';
}

interface SearchResultFile {
  type: 'file';
  sessionId: string;
  sessionTitle: string;
  path: string;
  name: string;
  nodeType: 'file' | 'directory';
}

export interface SearchResponse {
  sessions: SearchResultSession[];
  messages: SearchResultMessage[];
  files: SearchResultFile[];
}

function parseQuery(raw: string): { scope: 'all' | 'sessions' | 'messages' | 'files'; query: string } {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('session:') || lower.startsWith('sessions:')) {
    const prefixLen = lower.startsWith('session:') ? 8 : 9;
    return { scope: 'sessions', query: trimmed.slice(prefixLen).trim() };
  }
  if (lower.startsWith('message:') || lower.startsWith('messages:')) {
    const prefixLen = lower.startsWith('message:') ? 8 : 9;
    return { scope: 'messages', query: trimmed.slice(prefixLen).trim() };
  }
  if (lower.startsWith('file:') || lower.startsWith('files:')) {
    const prefixLen = lower.startsWith('file:') ? 5 : 6;
    return { scope: 'files', query: trimmed.slice(prefixLen).trim() };
  }
  return { scope: 'all', query: trimmed };
}

function filterSessions(sessions: ChatSession[], query: string): SearchResultSession[] {
  const q = query.toLowerCase();
  return sessions
    .filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.project_name.toLowerCase().includes(q),
    )
    .slice(0, MAX_RESULTS_PER_TYPE)
    .map((s) => ({
      type: 'session' as const,
      id: s.id,
      title: s.title,
      projectName: s.project_name,
      updatedAt: s.updated_at,
    }));
}

function collectNodes(
  tree: FileTreeNode[],
  sessionId: string,
  sessionTitle: string,
  query: string,
  results: SearchResultFile[],
): void {
  if (results.length >= MAX_RESULTS_PER_TYPE) return;
  const q = query.toLowerCase();
  for (const node of tree) {
    if (results.length >= MAX_RESULTS_PER_TYPE) break;
    if (node.name.toLowerCase().includes(q)) {
      results.push({
        type: 'file',
        sessionId,
        sessionTitle,
        path: node.path,
        name: node.name,
        nodeType: node.type,
      });
    }
    if (node.type === 'directory' && node.children) {
      collectNodes(node.children, sessionId, sessionTitle, query, results);
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get('q') || '';
    const { scope, query } = parseQuery(rawQuery);

    if (!query) {
      return Response.json({ sessions: [], messages: [], files: [] });
    }

    const allSessions = getAllSessions();
    const result: SearchResponse = { sessions: [], messages: [], files: [] };

    if (scope === 'all' || scope === 'sessions') {
      result.sessions = filterSessions(allSessions, query);
    }

    if (scope === 'all' || scope === 'messages') {
      const messageRows = searchMessages(query, { limit: MAX_RESULTS_PER_TYPE });
      result.messages = messageRows.map((r) => ({
        type: 'message' as const,
        sessionId: r.sessionId,
        sessionTitle: r.sessionTitle,
        messageId: r.messageId,
        role: r.role,
        snippet: r.snippet,
        createdAt: r.createdAt,
        contentType: r.contentType,
      }));
    }

    if (scope === 'all' || scope === 'files') {
      for (const session of allSessions) {
        if (!session.working_directory) continue;
        try {
          const tree = await scanDirectory(session.working_directory, FILE_SCAN_DEPTH);
          collectNodes(tree, session.id, session.title, query, result.files);
          if (result.files.length >= MAX_RESULTS_PER_TYPE) break;
        } catch {
          // Skip inaccessible/invalid session directories instead of failing the whole search.
          continue;
        }
      }
    }

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/search] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
