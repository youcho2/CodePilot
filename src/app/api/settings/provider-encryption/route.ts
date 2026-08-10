import { NextResponse } from "next/server";
import { getDb, disableProviderSecretEncryption } from "@/lib/db";
import { getProviderSecretEnvironmentStatus } from "@/lib/provider-secret-crypto";

/**
 * Provider-secret encryption toggle (fork: default off to avoid the ad-hoc
 * keychain re-prompt on every update). See
 * docs/exec-plans/active/provider-secret-encryption-toggle.md.
 *
 * The persisted on/off choice lives in an Electron userData flag written by the
 * main process (via IPC) — this route only performs the DB side:
 *   - disable: decrypt every encrypted key back to plaintext, which needs the
 *     data-encryption key still loaded THIS session (an encrypted boot).
 *   - enable: no-op here; encryption is re-applied at the next boot by the
 *     existing migrateProviderSecrets() once the key is loaded.
 */
export async function GET() {
  const status = getProviderSecretEnvironmentStatus();
  return NextResponse.json({
    keyLoadedThisSession: status.available,
    securityLevel: status.securityLevel ?? null,
  });
}

export async function POST(req: Request) {
  let enabled: unknown;
  try {
    ({ enabled } = await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled_must_be_boolean" }, { status: 400 });
  }

  if (enabled) {
    // Turning encryption ON: nothing to do server-side. The next boot loads the
    // key and migrateProviderSecrets() encrypts the plaintext rows.
    return NextResponse.json({ ok: true, action: "enable", note: "applies_on_restart" });
  }

  // Turning encryption OFF: decrypt existing ciphertext to plaintext now, while
  // the key is still loaded. If this session has no key, refuse so we never
  // strand encrypted rows behind a flag that stops loading the key.
  if (!getProviderSecretEnvironmentStatus().available) {
    return NextResponse.json(
      { error: "key_not_loaded", note: "restart_with_encryption_then_retry" },
      { status: 409 },
    );
  }
  const result = disableProviderSecretEncryption(getDb());
  if (result.failed > 0) {
    return NextResponse.json(
      { ok: false, error: "some_rows_failed", ...result },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, action: "disable", ...result });
}
