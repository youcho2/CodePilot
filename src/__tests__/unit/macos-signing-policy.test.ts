import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const { resolveMacosSigningMode } = require('../../../scripts/macos-signing-policy.cjs') as {
  resolveMacosSigningMode(input: {
    signatureOutput: string;
    requireDeveloperId: boolean;
    allowAdhoc: boolean;
    expectedTeamId: string;
  }): { mode: 'developer_id' | 'adhoc'; teamId: string | null };
};

const DEVELOPER_ID_SIGNATURE = [
  'Authority=Developer ID Application: CodePilot Team (TEAM123456)',
  'TeamIdentifier=TEAM123456',
].join('\n');

describe('macOS signing policy', () => {
  it('accepts only the configured Developer ID Team for distributable packages', () => {
    assert.deepEqual(resolveMacosSigningMode({
      signatureOutput: DEVELOPER_ID_SIGNATURE,
      requireDeveloperId: true,
      allowAdhoc: false,
      expectedTeamId: 'TEAM123456',
    }), { mode: 'developer_id', teamId: 'TEAM123456' });

    assert.throws(() => resolveMacosSigningMode({
      signatureOutput: DEVELOPER_ID_SIGNATURE,
      requireDeveloperId: true,
      allowAdhoc: false,
      expectedTeamId: 'OTHERTEAM1',
    }), /TeamIdentifier mismatch/);
  });

  it('fails closed when a distributable package is unsigned or ad-hoc', () => {
    assert.throws(() => resolveMacosSigningMode({
      signatureOutput: 'Signature=adhoc\nTeamIdentifier=not set',
      requireDeveloperId: true,
      allowAdhoc: true,
      expectedTeamId: 'TEAM123456',
    }), /Developer ID Application signature required/);
  });

  it('permits ad-hoc signing only through the explicit isolated-local flag', () => {
    assert.throws(() => resolveMacosSigningMode({
      signatureOutput: '',
      requireDeveloperId: false,
      allowAdhoc: false,
      expectedTeamId: '',
    }), /CODEPILOT_ALLOW_ADHOC_SIGNING=1/);

    assert.deepEqual(resolveMacosSigningMode({
      signatureOutput: '',
      requireDeveloperId: false,
      allowAdhoc: true,
      expectedTeamId: '',
    }), { mode: 'adhoc', teamId: null });
  });

  // Fork divergence: this fork has no Apple Developer Program account, so its
  // distributable release channel (build.yml) ships ad-hoc-signed, arm64-only
  // packages — NOT Developer ID. Upstream's original assertion (all workflows
  // wired to MAC_CERT_P12_BASE64 + a Developer ID post-package gate) is replaced
  // below with the fork's real policy. The signing-mode machinery, afterSign,
  // and the final verifier are still exercised by the other cases in this file;
  // afterSign simply takes its ad-hoc fallback branch when no certificate is
  // present. See docs/exec-plans/active/fork-self-update-pipeline.md.
  //
  // NOTE: preview-build.yml / preview-release.yml are still upstream Developer ID
  // templates (with Windows targets) that this fork cannot run without Apple
  // secrets; they are intentionally out of scope here and pending cleanup.
  it('ships build.yml as the fork ad-hoc, arm64-only release channel (no Developer ID cert)', () => {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build.yml'), 'utf8');

    // The macOS package step is ad-hoc: electron-builder is told not to auto-
    // discover a signing identity, and no certificate secret is wired in.
    assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s*["']false["']/);
    assert.doesNotMatch(workflow, /CSC_LINK:\s*\$\{\{ secrets\.MAC_CERT_P12_BASE64 \}\}/);
    assert.doesNotMatch(workflow, /CODEPILOT_REQUIRE_DEVELOPER_ID:\s*["']1["']/);

    // Fork ships Apple Silicon only — no x64 / Windows / Linux electron-builder targets.
    const packageStep = workflow
      .split(/\n(?=\s+- name:)/)
      .find((step) => /electron-builder --mac/.test(step));
    assert.ok(packageStep, 'build.yml must have a macOS electron-builder package step');
    assert.match(packageStep!, /--arm64/);
    assert.doesNotMatch(packageStep!, /--x64|--win|--linux/);
  });

  it('keeps afterSign and the final artifact verifier on the shared fail-closed policy', () => {
    const afterSign = fs.readFileSync(path.join(repoRoot, 'scripts/after-sign.js'), 'utf8');
    const finalVerifier = fs.readFileSync(
      path.join(repoRoot, 'scripts/verify-macos-developer-id.mjs'),
      'utf8',
    );
    assert.match(afterSign, /resolveMacosSigningMode\(\{/);
    assert.match(afterSign, /CODEPILOT_REQUIRE_DEVELOPER_ID === '1'/);
    assert.match(afterSign, /CODEPILOT_ALLOW_ADHOC_SIGNING === '1'/);
    assert.doesNotMatch(afterSign, /Signature verification FAILED/);
    assert.match(finalVerifier, /requireDeveloperId:\s*true/);
    assert.match(finalVerifier, /allowAdhoc:\s*false/);
    assert.match(finalVerifier, /--verify', '--deep', '--strict/);
    assert.match(finalVerifier, /CODESIGN_INSPECT_TIMEOUT_MS\s*=\s*15_000/);
    assert.match(finalVerifier, /CODESIGN_VERIFY_TIMEOUT_MS\s*=\s*60_000/);
    assert.match(finalVerifier, /spawnSync\('\/usr\/bin\/codesign',[\s\S]*?timeout,[\s\S]*?killSignal:\s*'SIGKILL'/);
    assert.match(finalVerifier, /result\.error\?\.code === 'ETIMEDOUT'/);
    assert.match(
      finalVerifier,
      /\['-d', '--verbose=4', appPath\],[\s\S]*?CODESIGN_INSPECT_TIMEOUT_MS/,
    );
    assert.match(
      finalVerifier,
      /\['--verify', '--deep', '--strict', '--verbose=4', appPath\],[\s\S]*?CODESIGN_VERIFY_TIMEOUT_MS/,
    );
  });
});
