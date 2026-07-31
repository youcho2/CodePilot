export const HTML_THUMBNAIL_CAPTURE_TIMEOUT_MS = 12_000;

export class HtmlThumbnailCaptureTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`HTML thumbnail capture timed out after ${timeoutMs}ms.`);
    this.name = 'HtmlThumbnailCaptureTimeoutError';
  }
}

export function deriveHtmlThumbnailRequestScope(targetUrl: URL): {
  origin: string;
  pathPrefix: string;
} {
  const match = targetUrl.pathname.match(
    /^(\/api\/files\/html-preview\/ws\.[^/]+\/)/,
  );
  if (!match) {
    throw new Error('HTML thumbnail URL is outside the workspace preview route.');
  }
  return {
    origin: targetUrl.origin,
    pathPrefix: match[1],
  };
}

export function isHtmlThumbnailRequestAllowed(
  requestUrl: string,
  scope: { origin: string; pathPrefix: string },
): boolean {
  try {
    const candidate = new URL(requestUrl);
    return (
      candidate.origin === scope.origin
      && candidate.pathname.startsWith(scope.pathPrefix)
    );
  } catch {
    return false;
  }
}

export class SerializedDeadlineQueue {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(
    task: () => Promise<T>,
    options: {
      timeoutMs: number;
      onTimeout?: () => void;
    },
  ): Promise<T> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        task(),
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            try {
              options.onTimeout?.();
            } finally {
              reject(new HtmlThumbnailCaptureTimeoutError(options.timeoutMs));
            }
          }, options.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      release();
    }
  }
}
