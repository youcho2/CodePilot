import { NextRequest, NextResponse } from 'next/server';
import { ProxyAgent } from 'undici';

export const runtime = 'nodejs';

/**
 * POST /api/settings/proxy-test
 * Read-only connectivity probe for a candidate network proxy. Does NOT persist
 * anything — the UI calls this with the value currently typed in the form so
 * the user can validate before saving.
 *
 * Reaches api.anthropic.com through the given proxy. ANY HTTP response
 * (including 401/403 — no credentials are sent) means the proxy connected and
 * forwarded the request; a connect/timeout error means the proxy is unusable.
 */
const PROBE_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 12_000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';

    if (!rawUrl) {
      return NextResponse.json({ ok: false, reason: 'empty', error: 'No proxy URL provided' }, { status: 400 });
    }

    let proxyUrl: URL;
    try {
      proxyUrl = new URL(rawUrl);
    } catch {
      return NextResponse.json({ ok: false, reason: 'invalid_url', error: 'Not a valid URL' }, { status: 400 });
    }
    if (proxyUrl.protocol !== 'http:' && proxyUrl.protocol !== 'https:') {
      return NextResponse.json(
        { ok: false, reason: 'unsupported_scheme', error: `Unsupported proxy scheme: ${proxyUrl.protocol}` },
        { status: 400 },
      );
    }

    const dispatcher = new ProxyAgent(proxyUrl.toString());
    try {
      const res = await fetch(PROBE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // @ts-expect-error — undici dispatcher is accepted by Node's fetch
        dispatcher,
      });
      // Reachable through the proxy — the HTTP status itself doesn't matter
      // (no auth is sent, so 401/403 is expected and still proves the tunnel).
      return NextResponse.json({ ok: true, status: res.status });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason = /timed out|timeout|aborted/i.test(message) ? 'timeout' : 'connect_failed';
      return NextResponse.json({ ok: false, reason, error: message });
    } finally {
      dispatcher.close().catch(() => {});
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proxy test failed';
    return NextResponse.json({ ok: false, reason: 'internal', error: message }, { status: 500 });
  }
}
