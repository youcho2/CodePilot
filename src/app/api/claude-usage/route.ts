/**
 * GET /api/claude-usage
 *
 * Live Claude Code subscription usage — the same data the `/usage` slash
 * command shows (session / weekly windows + used %). Wraps
 * `readClaudeUsage()` which hits the internal `/api/oauth/usage` endpoint
 * with the stored claude.ai OAuth token.
 *
 * Non-throwing: always HTTP 200 with a discriminated body so the UsageCockpit
 * popover can render an honest empty state instead of breaking:
 *
 *   { snapshot }                        — success
 *   { snapshot: null, reason: 'no-oauth' | 'expired' | 'unauthorized'
 *                             | 'unavailable', error? }
 *
 * `reason: 'no-oauth'` means the session isn't on a claude.ai subscription
 * (API-key / third-party) — there is genuinely no quota to show, not a 0.
 */

import { NextResponse } from 'next/server';
import { readClaudeUsage } from '@/lib/claude-usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await readClaudeUsage();
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ snapshot: null, reason: 'unavailable', error }, { status: 200 });
  }
}
