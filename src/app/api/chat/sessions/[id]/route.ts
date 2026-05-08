import { NextRequest } from 'next/server';
import { deleteSession, getSession, updateSessionWorkingDirectory, updateSessionTitle, updateSessionMode, updateSessionModel, updateSessionProviderId, clearSessionMessages, updateSdkSessionId, updateSessionPermissionProfile, updateSessionRuntime } from '@/lib/db';
import { autoApprovePendingForSession } from '@/lib/bridge/permission-broker';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    return Response.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get session';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const body = await request.json();

    if (body.working_directory) {
      updateSessionWorkingDirectory(id, body.working_directory);
    }
    if (body.title) {
      updateSessionTitle(id, body.title);
    }
    if (body.mode) {
      updateSessionMode(id, body.mode);
    }
    // Track whether provider, model, or runtime_pin actually changed — if so,
    // the old sdk_session_id is stale and must be cleared to prevent resume
    // failures against a different provider/model/runtime (fixes #343, #346;
    // Step 4c extends to runtime_pin since SDK sessions can't survive a
    // runtime swap either).
    const modelChanged = body.model !== undefined && body.model !== session.model;
    const providerChanged = body.provider_id !== undefined && body.provider_id !== session.provider_id;
    let runtimePinChanged = false;
    if (body.runtime_pin !== undefined) {
      // Step 4c — session-level runtime switch from the composer toolbar.
      // Valid values: '' (follow global), 'claude_code', 'codepilot_runtime'.
      // Anything else is a client bug and we 400 rather than write garbage.
      if (body.runtime_pin !== '' && body.runtime_pin !== 'claude_code' && body.runtime_pin !== 'codepilot_runtime') {
        return Response.json({ error: 'runtime_pin must be "", "claude_code", or "codepilot_runtime"' }, { status: 400 });
      }
      runtimePinChanged = body.runtime_pin !== (session.runtime_pin || '');
      if (runtimePinChanged) {
        updateSessionRuntime(id, body.runtime_pin);
      }
    }

    if (body.model !== undefined) {
      updateSessionModel(id, body.model);
    }
    if (body.provider_id !== undefined) {
      updateSessionProviderId(id, body.provider_id);
    }
    if (body.sdk_session_id !== undefined) {
      updateSdkSessionId(id, body.sdk_session_id);
    }

    // Server-side guard: when provider, model, or runtime_pin changed and the
    // caller didn't explicitly set sdk_session_id in the same request,
    // force-clear it so the next chat message starts a fresh SDK session
    // instead of trying to resume the old one (which would fail with a
    // different provider/model/runtime).
    if ((modelChanged || providerChanged || runtimePinChanged) && body.sdk_session_id === undefined) {
      if (session.sdk_session_id) {
        console.log(
          `[session-api] Provider/model/runtime changed for session ${id}, clearing stale sdk_session_id`,
          { modelChanged, providerChanged, runtimePinChanged, oldSdkSessionId: session.sdk_session_id.slice(0, 8) + '...' }
        );
      }
      updateSdkSessionId(id, '');
    }
    if (body.permission_profile !== undefined) {
      if (body.permission_profile !== 'default' && body.permission_profile !== 'full_access') {
        return Response.json({ error: 'permission_profile must be "default" or "full_access"' }, { status: 400 });
      }
      // When switching to full_access, auto-approve any pending bridge permissions
      const previousProfile = session.permission_profile || 'default';
      updateSessionPermissionProfile(id, body.permission_profile);
      if (previousProfile !== 'full_access' && body.permission_profile === 'full_access') {
        try {
          autoApprovePendingForSession(id);
        } catch (err) {
          console.warn('[session-api] Failed to auto-approve pending permissions:', err);
        }
      }
    }
    if (body.clear_messages) {
      clearSessionMessages(id);
    }

    const updated = getSession(id);
    return Response.json({ session: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update session';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    deleteSession(id);
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete session';
    return Response.json({ error: message }, { status: 500 });
  }
}
