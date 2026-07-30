import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import {
  HARNESS_HOME_ROOT_SETTING,
} from '@/lib/harness-home/runtime/configured';
import {
  listCreativeProjects,
  writeCreativeProject,
  type CreativeProjectState,
} from '@/lib/harness-home/creative-project';
import { FileHarnessRepository } from '@/lib/harness-home/repository';

function configuredRoot(): string | null {
  return getSetting(HARNESS_HOME_ROOT_SETTING)?.trim() || null;
}

export async function GET() {
  const root = configuredRoot();
  if (!root) {
    return NextResponse.json({ configured: false, projects: [] });
  }
  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(root, { mode: 'readonly' });
    return NextResponse.json({
      configured: true,
      root: repository.root,
      generation: repository.manifest.generation,
      projects: listCreativeProjects(repository).map((record) => ({
        ...record.project,
        contentHash: record.ref.contentHash,
        path: record.ref.path,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  } finally {
    repository?.close();
  }
}

export async function POST(request: NextRequest) {
  const root = configuredRoot();
  if (!root) {
    return NextResponse.json(
      { error: 'Configure a Harness Home root before writing a creative project.' },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => null) as {
    project?: CreativeProjectState;
    sourceRef?: unknown;
    expectedContentHash?: unknown;
  } | null;
  if (
    !body?.project
    || typeof body.sourceRef !== 'string'
    || (
      body.expectedContentHash !== undefined
      && typeof body.expectedContentHash !== 'string'
    )
  ) {
    return NextResponse.json(
      { error: 'project and sourceRef are required.' },
      { status: 400 },
    );
  }
  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(root, { mode: 'require-writable' });
    const result = writeCreativeProject(repository, {
      project: body.project,
      sourceRef: body.sourceRef,
      ...(typeof body.expectedContentHash === 'string'
        ? { expectedContentHash: body.expectedContentHash }
        : {}),
    });
    return NextResponse.json(result, {
      status: result.status === 'created' ? 201 : 200,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  } finally {
    repository?.close();
  }
}
