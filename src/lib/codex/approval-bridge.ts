/**
 * Codex approval bridge — Phase 5 Phase 4 Slice 2 (2026-05-13).
 *
 * Routes Codex's server-originated approval requests through
 * CodePilot's existing PermissionPrompt UI instead of returning a
 * blanket decline-by-default.
 *
 * Flow:
 *
 *   Codex JSON-RPC server request `item/commandExecution/requestApproval`
 *     → CodexAppServerClient.routeServerRequest
 *     → CodexRuntime onServerRequest handler
 *     → handleCodexApprovalRequest (this module):
 *         1. translate to canonical RuntimePermissionEvent via
 *            `translateCodexApproval`
 *         2. write a permission_requests DB row so the existing
 *            `/api/chat/permission` route's validation passes
 *         3. emit an SDK-shaped `permission_request` SSE event so the
 *            existing useSSEStream + PermissionPrompt path picks it up
 *            unchanged (UI doesn't branch on runtime)
 *         4. await `registerPendingPermission` — same registry the SDK
 *            uses; user response from /api/chat/permission resolves it
 *         5. translate PermissionResult → the Codex response shape that
 *            matches THIS approval method (execCommand, fileChange,
 *            permissions, or legacy alias all have different responses)
 *
 * Response shapes per `资料/codex/.../schema/typescript/v2/`:
 *
 *   - `item/commandExecution/requestApproval` →
 *     CommandExecutionRequestApprovalResponse = { decision:
 *       'accept' | 'acceptForSession' | 'decline' | 'cancel' | ...amendments }
 *   - `item/fileChange/requestApproval` →
 *     FileChangeRequestApprovalResponse = { decision: FileChangeApprovalDecision }
 *     where FileChangeApprovalDecision = 'accept' | 'acceptForSession' |
 *       'decline' | 'cancel'
 *   - `item/permissions/requestApproval` →
 *     PermissionsRequestApprovalResponse = { permissions, scope,
 *       strictAutoReview? } — entirely different shape; MVP throws an
 *     error which Codex treats as a failed approval (effectively decline).
 *     Phase 6 wires the full UI for granting specific permission profiles.
 *   - Legacy `execCommandApproval` + `applyPatchApproval` →
 *     ApplyPatchApprovalResponse = { decision: ReviewDecision }
 *     where ReviewDecision = 'approved' | 'approved_for_session' |
 *       'denied' | 'timed_out' | 'abort' | ...amendments
 */

import type { PermissionRequestEvent, PermissionSuggestion } from '@/types';
import type { NativePermissionResult } from '@/lib/types/agent-types';
import { translateCodexApproval } from './event-mapper';
import { createPermissionRequest } from '@/lib/db';
import { registerPendingPermission } from '@/lib/permission-registry';

/**
 * Generate a stable permissionRequestId from the Codex JSON-RPC id.
 * The `codex:` prefix lets log scrapers / tests recognize Codex-origin
 * approvals without having to query the registry first.
 */
export function makeCodexPermissionRequestId(jsonRpcId: number | string): string {
  return `codex:${jsonRpcId}`;
}

interface HandleArgs {
  sessionId: string;
  jsonRpcId: number | string;
  method: string;
  params: unknown;
  /** Emit an SSE line into the chat stream. */
  emitSse: (line: string) => void;
}

/**
 * Handle one Codex approval request end-to-end. Resolves with the
 * runtime-specific response shape Codex expects, OR throws to surface
 * an error response to Codex (which it treats as failed approval).
 */
export async function handleCodexApprovalRequest(args: HandleArgs): Promise<unknown> {
  const requestId = makeCodexPermissionRequestId(args.jsonRpcId);
  const canonical = translateCodexApproval({
    method: args.method,
    params: args.params,
    sessionId: args.sessionId,
    requestId,
  });

  // Conservative fallback: unmapped approval kinds → permission_unavailable.
  // Don't emit a permission_request to UI; respond with an error so
  // Codex treats it as decline-failed rather than hanging.
  // (Type narrowing: translateCodexApproval only returns request OR
  // unavailable; this guard collapses the union to permission_request.)
  if (canonical.type !== 'permission_request') {
    throw new Error(`Codex approval kind not yet supported: ${args.method}`);
  }

  // Translate canonical → SDK-shaped PermissionRequestEvent so the
  // existing useSSEStream / PermissionPrompt pipeline picks it up
  // unchanged. UI doesn't care about runtime; the bridge does the
  // shape adaptation.
  const sdkPermission: PermissionRequestEvent = {
    permissionRequestId: requestId,
    toolName: canonical.toolName,
    toolInput: canonical.toolInput ?? {},
    toolUseId: canonical.toolUseId ?? '',
    description: canonical.subject,
    decisionReason: canonical.details,
    suggestions: canonical.permissionHints?.map((h): PermissionSuggestion => ({
      type: h.type,
      ...(h.rules ? { rules: [...h.rules] } : {}),
      ...(h.behavior !== undefined ? { behavior: h.behavior } : {}),
      ...(h.destination !== undefined ? { destination: h.destination } : {}),
    })),
  };

  // Persist to permission_requests so the existing /api/chat/permission
  // route's `getPermissionRequest(id)` validation succeeds.
  try {
    createPermissionRequest({
      id: requestId,
      sessionId: args.sessionId,
      toolName: canonical.toolName,
      toolInput: JSON.stringify(canonical.toolInput ?? {}),
      decisionReason: canonical.details,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    // Logging-only failure; the in-memory registry is the source of
    // truth for resolution. A DB write failure won't block approval.
    console.warn('[codex.approval] createPermissionRequest failed:', err);
  }

  // Emit SSE permission_request event so PermissionPrompt renders.
  args.emitSse(
    `data: ${JSON.stringify({
      type: 'permission_request',
      data: JSON.stringify(sdkPermission),
    })}\n\n`,
  );

  // Wait for the user's decision. registerPendingPermission resolves
  // via /api/chat/permission → resolvePendingPermission — the same
  // path the SDK uses, so PermissionPrompt's existing wire-up works.
  const result = await registerPendingPermission(requestId, canonical.toolInput ?? {});

  return resultToCodexResponse(result, args.method);
}

/**
 * Translate the SDK-shaped `NativePermissionResult` into the Codex
 * response payload that matches the approval method.
 *
 * Mapping rules:
 *
 *   allow + updatedPermissions.length > 0  → "acceptForSession" (canonical)
 *                                          / "approved_for_session" (legacy)
 *   allow                                  → "accept" (canonical)
 *                                          / "approved" (legacy)
 *   deny                                   → "decline" (canonical)
 *                                          / "denied" (legacy)
 *
 * `item/permissions/requestApproval` requires an entirely different
 * shape; for MVP we don't reach this fn for that method — the
 * handleCodexApprovalRequest path throws above. Phase 6 wires the
 * full permission-grant UI and replaces the throw with a structured
 * GrantedPermissionProfile.
 */
/**
 * Exported for unit testing the mapping table. Not part of the
 * public adapter surface — runtime call sites use
 * `handleCodexApprovalRequest`.
 */
export function resultToCodexResponse(
  result: NativePermissionResult,
  method: string,
): { decision: string } {
  const legacy = method === 'execCommandApproval' || method === 'applyPatchApproval';
  const sessionScope =
    result.behavior === 'allow' &&
    Array.isArray(result.updatedPermissions) &&
    result.updatedPermissions.length > 0;

  if (result.behavior === 'allow') {
    return {
      decision: sessionScope
        ? legacy ? 'approved_for_session' : 'acceptForSession'
        : legacy ? 'approved' : 'accept',
    };
  }
  return { decision: legacy ? 'denied' : 'decline' };
}
