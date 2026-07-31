export type LocalPathKind = 'file' | 'directory' | 'other';

export class LocalPathInspectionError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LocalPathInspectionError';
  }
}

export async function inspectLocalPath(
  filePath: string,
  baseDir?: string,
  fetcher: typeof fetch = fetch,
): Promise<LocalPathKind> {
  const params = new URLSearchParams({ path: filePath });
  if (baseDir) params.set('baseDir', baseDir);
  const response = await fetcher(`/api/files/inspect?${params}`);
  const body = await response.json().catch(() => ({})) as {
    kind?: LocalPathKind;
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new LocalPathInspectionError(
      body.error || `Path inspection failed (${response.status})`,
      body.code,
      response.status,
    );
  }
  if (body.kind !== 'file' && body.kind !== 'directory' && body.kind !== 'other') {
    throw new LocalPathInspectionError('Path inspection returned an invalid result');
  }
  return body.kind;
}

type ShellPathOpener = {
  openPath: (path: string) => Promise<string>;
};

/**
 * Open a local path with the operating system. Electron resolves with an
 * empty string on success and an error message on failure.
 */
export async function openPathWithSystem(
  filePath: string,
  opener?: ShellPathOpener,
): Promise<void> {
  const resolvedOpener = opener ?? (
    typeof window !== 'undefined' ? window.electronAPI?.shell : undefined
  );
  if (!resolvedOpener?.openPath) {
    throw new Error('System open is unavailable outside the desktop app');
  }
  const error = await resolvedOpener.openPath(filePath);
  if (error) throw new Error(error);
}
