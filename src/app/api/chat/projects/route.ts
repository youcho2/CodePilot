import { NextRequest } from 'next/server';
import { getKnownProjects } from '@/lib/db';
import type { ProjectsResponse } from '@/types';
import { serverErrorResponse } from '@/lib/api-error';

/**
 * Distinct project folders, archived sessions INCLUDED. The sidebar unions this
 * with the grouped visible sessions so a project whose conversations are all
 * archived stays visible as an empty folder (instead of vanishing). `source`
 * mirrors GET /api/chat/sessions: omitted/'user' → user sessions only (default),
 * 'task' → task-bound only, 'all' → no filter.
 */
export async function GET(request: NextRequest) {
  try {
    const sourceParam = request.nextUrl.searchParams.get('source');
    const includeSources: ReadonlyArray<'user' | 'task'> | undefined =
      sourceParam === 'task'
        ? ['task']
        : sourceParam === 'all'
          ? undefined
          : ['user'];
    const projects = getKnownProjects(includeSources ? { includeSources } : undefined);
    const response: ProjectsResponse = { projects };
    return Response.json(response);
  } catch (error) {
    return serverErrorResponse('GET /api/chat/projects', error);
  }
}
