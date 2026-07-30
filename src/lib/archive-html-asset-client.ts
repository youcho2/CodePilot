export type ArchiveHtmlAssetInput =
  | {
    sessionId: string;
    source: 'workspace';
    filePath: string;
    prompt?: string;
  }
  | {
    sessionId: string;
    source: 'inline';
    html: string;
    prompt?: string;
  };

export interface ArchivedHtmlAsset {
  id: string;
  kind: 'html_bundle';
  contentHash: string;
  lifecycleState: string;
  integrityState: string;
}

export async function archiveHtmlAsset(
  input: ArchiveHtmlAssetInput,
): Promise<ArchivedHtmlAsset> {
  const response = await fetch('/api/assets/html-bundles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as {
    asset?: ArchivedHtmlAsset;
    error?: string;
  };
  if (!response.ok || !payload.asset) {
    throw new Error(payload.error || response.statusText || 'Archive failed.');
  }
  return payload.asset;
}
