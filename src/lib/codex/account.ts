/**
 * Codex account helpers — Phase 5 Phase 2 (2026-05-13).
 *
 * Thin async wrappers around `account/read` + login methods on the
 * shared app-server client. Surfaces the narrowed
 * `CodexAccountState` discriminated union the UI consumes; callers
 * don't inspect the upstream `Account` shape directly.
 *
 * Login flow per `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/LoginAccountResponse.ts`:
 *
 *   - `{ type: 'chatgpt', loginId, authUrl }`: open `authUrl` in a
 *     browser; listen for `account/login/completed` notification.
 *   - `{ type: 'chatgptDeviceCode', loginId, verificationUrl, userCode }`:
 *     same plus a user-entered code.
 *   - `{ type: 'apiKey' }` / `{ type: 'chatgptAuthTokens' }`: synchronous.
 *
 * CodePilot drives the streamlined ChatGPT flow today; API key /
 * device-code variants are exposed but not the default path.
 */

import type {
  CodexAccount,
  CodexAccountState,
  JsonRpcMessage,
} from './types';
import { getCodexAppServer } from './app-server-manager';

/**
 * Fetch the current Codex account state. Doesn't refresh tokens
 * unless `refresh: true` is passed (which delegates to Codex's
 * built-in refresh path; see GetAccountParams.refreshToken).
 *
 * Returns `{ kind: 'logged_out' }` when Codex reports `account: null`
 * — that's the canonical "no auth yet" signal per the schema.
 */
export async function readCodexAccount(
  refresh = false,
): Promise<CodexAccountState> {
  const { client } = await getCodexAppServer();
  const result = await client.request<{
    account: ({ type: 'apiKey' } | { type: 'chatgpt'; email: string; planType: string } | { type: 'amazonBedrock' }) | null;
    requiresOpenaiAuth: boolean;
  }>('account/read', { refreshToken: refresh });

  if (!result.account) return { kind: 'logged_out' };

  // Narrow upstream discriminated union into our CodexAccount.
  const account: CodexAccount =
    result.account.type === 'chatgpt'
      ? {
          type: 'chatgpt',
          email: result.account.email,
          planType: result.account.planType,
        }
      : { type: result.account.type };

  return { kind: 'logged_in', account };
}

export interface CodexLoginStartChatGpt {
  type: 'chatgpt';
  /**
   * Browser URL to open. The user authenticates there; Codex emits
   * `account/login/completed` when done.
   */
  authUrl: string;
  /** Login session identifier for matching the completion event. */
  loginId: string;
}

export interface CodexLoginStartDeviceCode {
  type: 'chatgptDeviceCode';
  verificationUrl: string;
  userCode: string;
  loginId: string;
}

export interface CodexLoginStartApiKey {
  type: 'apiKey';
}

export type CodexLoginStart =
  | CodexLoginStartChatGpt
  | CodexLoginStartDeviceCode
  | CodexLoginStartApiKey;

/**
 * Kick off a Codex login. ChatGPT streamlined flow is the default —
 * caller opens the returned `authUrl` in the user's browser and waits
 * for the `account/login/completed` notification (use
 * `waitForLoginCompleted` below).
 */
export async function startCodexLogin(
  options:
    | { kind: 'chatgpt' }
    | { kind: 'chatgptDeviceCode' }
    | { kind: 'apiKey'; apiKey: string } = { kind: 'chatgpt' },
): Promise<CodexLoginStart> {
  const { client } = await getCodexAppServer();
  switch (options.kind) {
    case 'chatgpt': {
      const result = await client.request<{
        type: 'chatgpt';
        loginId: string;
        authUrl: string;
      }>('account/login/start', {
        type: 'chatgpt',
        codexStreamlinedLogin: true,
      });
      return { type: 'chatgpt', loginId: result.loginId, authUrl: result.authUrl };
    }
    case 'chatgptDeviceCode': {
      const result = await client.request<{
        type: 'chatgptDeviceCode';
        loginId: string;
        verificationUrl: string;
        userCode: string;
      }>('account/login/start', { type: 'chatgptDeviceCode' });
      return {
        type: 'chatgptDeviceCode',
        loginId: result.loginId,
        verificationUrl: result.verificationUrl,
        userCode: result.userCode,
      };
    }
    case 'apiKey': {
      await client.request('account/login/start', {
        type: 'apiKey',
        apiKey: options.apiKey,
      });
      return { type: 'apiKey' };
    }
    default: {
      const _: never = options;
      throw new Error(`unknown login kind ${String(_)}`);
    }
  }
}

/**
 * Wait for `account/login/completed` notification matching the given
 * loginId. Returns success/error info per the upstream schema:
 *   `{ loginId, success, error }`
 *
 * Caller is responsible for the timeout — this fn doesn't impose one
 * because login flows can legitimately take minutes (user pasting
 * verification code etc.).
 */
export function waitForLoginCompleted(loginId: string): Promise<{
  success: boolean;
  error: string | null;
}> {
  return new Promise(async (resolve) => {
    const { client } = await getCodexAppServer();
    const unsubscribe = client.onNotification('account/login/completed', (params) => {
      const p = params as { loginId: string | null; success: boolean; error: string | null };
      if (p.loginId === loginId) {
        unsubscribe();
        resolve({ success: p.success, error: p.error });
      }
    });
  });
}

/** Cancel an in-progress login (browser flow abandoned). */
export async function cancelCodexLogin(loginId: string): Promise<void> {
  const { client } = await getCodexAppServer();
  await client.request('account/login/cancel', { loginId });
}

/** Log out of Codex (clears the user's auth token on disk). */
export async function logoutCodex(): Promise<void> {
  const { client } = await getCodexAppServer();
  await client.request('account/logout');
}

// Re-export JsonRpcMessage so external consumers (tests) can typecheck
// notification payloads without importing the wire types module.
export type { JsonRpcMessage };
