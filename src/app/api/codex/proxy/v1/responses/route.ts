/**
 * POST /api/codex/proxy/v1/responses
 *
 * Phase 5b — CodePilot provider proxy entry point.
 *
 * Codex's HTTP client routes here when a thread's `model_provider`
 * is the injected `codepilot_proxy` (see
 * `src/lib/codex/provider-proxy.ts` for the injection shape). The
 * route is intentionally a thin HTTP shell:
 *
 *   1. Read target provider header.
 *   2. Parse + validate the Responses request body.
 *   3. Hand off to the proxy adapter (`handleProxyRequest`).
 *   4. Serialise the ProxyResult into either an SSE stream
 *      (`Content-Type: text/event-stream`) or a JSON body.
 *
 * Pre-stream errors (provider not found, credentials missing, adapter
 * still pending) come back as `kind: 'error'` and we map them to
 * HTTP status code + JSON. During-stream errors come back as
 * `kind: 'stream'` with an embedded `response.failed` event; the
 * route still returns 200 because the SSE protocol carries the
 * error.
 *
 * Phase 5b adapter status: foundation only — the per-family
 * adapters (OpenAI / Anthropic / CodePlan) still return
 * `adapter_not_implemented` via the wire. That's a structured
 * Responses error, NOT the pre-5b raw 501.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { handleProxyRequest } from '@/lib/codex/proxy/adapter';
import { parseResponsesRequest } from '@/lib/codex/proxy/parse-request';
import { makeErrorResult, toNonStreamErrorBody } from '@/lib/codex/proxy/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const targetProviderId = request.headers.get('x-codepilot-target-provider') ?? '';

  // Parse body — fail fast with a JSON 400 if it's not valid JSON or
  // doesn't satisfy the Responses shape. The error body is the same
  // shape every error returns so Codex's HTTP client only has one
  // error envelope to recognise.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    const result = makeErrorResult(
      'invalid_request',
      `Request body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json(toNonStreamErrorBody(result.error), { status: result.status });
  }

  const parseResult = parseResponsesRequest(rawBody);
  if (!parseResult.ok) {
    const result = makeErrorResult(
      'invalid_request',
      parseResult.message,
      parseResult.field ? { field: parseResult.field } : undefined,
    );
    return NextResponse.json(toNonStreamErrorBody(result.error), { status: result.status });
  }

  // Dispatch to the adapter. The adapter contract guarantees it
  // never throws — but the route wraps defensively so an unexpected
  // bug doesn't crash Codex's HTTP read loop.
  let proxyResult;
  try {
    proxyResult = await handleProxyRequest({
      targetProviderId,
      body: parseResult.body,
      signal: request.signal,
    });
  } catch (err) {
    const result = makeErrorResult(
      'internal_error',
      `Unexpected proxy error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json(toNonStreamErrorBody(result.error), { status: result.status });
  }

  // Serialise. Three result shapes; route just translates HTTP.
  if (proxyResult.kind === 'error') {
    return NextResponse.json(toNonStreamErrorBody(proxyResult.error), {
      status: proxyResult.status,
    });
  }
  if (proxyResult.kind === 'json') {
    return NextResponse.json(proxyResult.body, { status: 200 });
  }
  // SSE stream. Codex's HTTP client looks for `text/event-stream`.
  return new Response(proxyResult.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
