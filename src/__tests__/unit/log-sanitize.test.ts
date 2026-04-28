/**
 * Tests for `electron/log-sanitize.ts`.
 *
 * The persistent log file is the user's primary support entry (About →
 * "打开日志文件夹"). These tests pin the redaction rules that make the
 * file safe to attach to an issue — every leak that shows up in
 * practice should land here as a test before the regex changes.
 *
 * Run via `node --test` (the same harness the rest of the unit tests
 * use). The module has no Electron / FS deps, so it runs unmodified
 * outside the Electron process.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeLogLine } from "../../../electron/log-sanitize";

describe("sanitizeLogLine — vendor-prefixed API keys", () => {
  it("masks sk- style Anthropic / OpenAI keys, keeps prefix + last 4", () => {
    const out = sanitizeLogLine(
      "[provider] using key sk-ant-api03-AbC1234567890DefGhIjKlMnOpQrStUvWxYzABCD",
    );
    // Must NOT contain the random middle of the key.
    assert.ok(!out.includes("AbC1234567890DefGhIjKlMnOpQr"));
    // Must contain a masked replacement preserving prefix + last 4.
    assert.ok(/sk-(?:ant-)?[A-Za-z0-9-]*\*\*\*[A-Za-z0-9]{4}/.test(out));
  });

  it("masks GitHub PAT (ghp_)", () => {
    const out = sanitizeLogLine(
      "fetched repo with ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1234",
    );
    assert.ok(!out.includes("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    assert.match(out, /ghp_\*\*\*1234/);
  });

  it("masks HuggingFace tokens (hf_)", () => {
    const out = sanitizeLogLine("auth: hf_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234");
    assert.match(out, /hf_\*\*\*1234/);
  });
});

describe("sanitizeLogLine — Bearer / Authorization", () => {
  it("masks Bearer tokens anywhere in the line", () => {
    const out = sanitizeLogLine(
      'curl failed: > Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9XXXX',
    );
    assert.ok(!out.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
    // Should still be readable as Bearer ***LAST4 OR Authorization: ***LAST4.
    // The Authorization pattern wins on this line because it includes "Authorization: ".
    assert.ok(out.includes("***XXXX"));
  });

  it("masks JSON-encoded Authorization header values", () => {
    const out = sanitizeLogLine(
      '{"headers":{"Authorization":"Bearer abcdef0123456789abcd5678"}}',
    );
    assert.ok(!out.includes("abcdef0123456789abcd"));
    assert.ok(out.includes("***5678") || out.includes("***"));
  });
});

describe("sanitizeLogLine — URL query secrets", () => {
  it("strips token / api_key / access_token query values, keeps host + path", () => {
    const out = sanitizeLogLine(
      "GET https://api.example.com/v1/chat?api_key=sk_live_abcdefgh&token=tok_xyz12345&model=gpt-4",
    );
    assert.ok(!out.includes("sk_live_abcdefgh"));
    assert.ok(!out.includes("tok_xyz12345"));
    // Hostname + path + non-secret query (model=gpt-4) preserved.
    assert.ok(out.includes("api.example.com/v1/chat"));
    assert.ok(out.includes("model=gpt-4"));
    // Secret keys redacted.
    assert.match(out, /api_key=\*\*\*/);
    assert.match(out, /token=\*\*\*/);
  });

  it("handles common variants: x-api-key, password, access-token", () => {
    const out = sanitizeLogLine(
      "url=https://x.example/api?x-api-key=AKIASOMEACCESSKEYID&password=hunter2&access_token=ya29.A0",
    );
    assert.match(out, /x-api-key=\*\*\*/);
    assert.match(out, /password=\*\*\*/);
    assert.match(out, /access_token=\*\*\*/);
  });
});

describe("sanitizeLogLine — home path", () => {
  it("replaces the user's home directory with ~", () => {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (!home) return; // CI without HOME — skip
    const out = sanitizeLogLine(`config loaded from ${home}/.codepilot/settings.json`);
    assert.ok(!out.includes(home));
    assert.match(out, /~\/\.codepilot\/settings\.json/);
  });
});

describe("sanitizeLogLine — opaque blob heuristic", () => {
  it("masks long base64-ish strings", () => {
    const out = sanitizeLogLine("session token: AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEF_xyz");
    // Original middle should be gone.
    assert.ok(!out.includes("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"));
  });

  it("does NOT mask plain hex strings under 64 chars (commit hashes / uuids)", () => {
    const out = sanitizeLogLine("commit deadbeef0123456789abcdef0123456789abcdef");
    // 40-char hex commit hash is left alone — debug context is more
    // important than worst-case false positive here.
    assert.ok(out.includes("deadbeef0123456789abcdef0123456789abcdef"));
  });

  it("does NOT mask all-digit numbers (IDs, timestamps)", () => {
    const out = sanitizeLogLine("session_id=1234567890123456789012345678901234567890");
    assert.ok(out.includes("1234567890123456789012345678901234567890"));
  });

  it("preserves non-secret content around masked tokens", () => {
    const out = sanitizeLogLine(
      "[provider] api.anthropic.com -> sk-ant-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1234 (200 OK)",
    );
    assert.ok(out.includes("api.anthropic.com"));
    assert.ok(out.includes("(200 OK)"));
    assert.ok(!out.includes("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
  });
});

describe("sanitizeLogLine — idempotence", () => {
  it("running twice doesn't double-mask or expand masked output", () => {
    const original = "[auth] Bearer eyJhbGciOiJIUzI1NiIs.payload.sig1234";
    const once = sanitizeLogLine(original);
    const twice = sanitizeLogLine(once);
    // Idempotent in the sense that already-masked output stays masked.
    assert.equal(twice, once);
  });
});
