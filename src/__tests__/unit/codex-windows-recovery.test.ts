import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildCodexPowerShellLaunchSpec,
  CODEX_WINDOWS_INSTALL_COMMAND,
  isTrustedCodexRecoverySender,
} from '../../../electron/codex-windows-recovery';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('Codex recovery command is fixed to the official installer and never becomes PowerShell argv', () => {
  assert.equal(CODEX_WINDOWS_INSTALL_COMMAND, 'irm https://chatgpt.com/codex/install.ps1 | iex');
  const spec = buildCodexPowerShellLaunchSpec('win32', 'C:\\Windows');
  assert.equal(spec.command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(spec.args, ['-NoLogo', '-NoExit']);
  assert.equal(spec.shell, false);
  assert.equal(spec.windowsHide, false);
  assert.equal(spec.args.some((arg) => arg.includes('install.ps1')), false);
});

test('Codex recovery is Windows-only and trusts only the current loopback renderer port', () => {
  assert.throws(() => buildCodexPowerShellLaunchSpec('darwin'), /unsupported_platform/);
  assert.equal(isTrustedCodexRecoverySender('http://127.0.0.1:3000/settings/runtime', 3000), true);
  assert.equal(isTrustedCodexRecoverySender('http://localhost:3000/settings/runtime', 3000), false);
  assert.equal(isTrustedCodexRecoverySender('http://127.0.0.1:3001/settings/runtime', 3000), false);
  assert.equal(isTrustedCodexRecoverySender('https://127.0.0.1:3000/settings/runtime', 3000), false);
});

test('main/preload bridge exposes only a no-argument prepare action and does not auto-execute the installer', () => {
  const main = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(repoRoot, 'electron/preload.ts'), 'utf8');
  const panel = fs.readFileSync(path.join(repoRoot, 'src/components/settings/RuntimePanel.tsx'), 'utf8');
  const handlerStart = main.indexOf("ipcMain.handle('codex:prepare-windows-recovery'");
  assert.ok(handlerStart >= 0);
  const handler = main.slice(handlerStart, handlerStart + 2_400);
  assert.match(handler, /clipboard\.writeText\(CODEX_WINDOWS_INSTALL_COMMAND\)/);
  assert.match(handler, /buildCodexPowerShellLaunchSpec\(\)/);
  assert.match(handler, /shell:\s*spec\.shell/);
  assert.doesNotMatch(handler, /install\.ps1|\|-?Command|sendInput|paste/i);
  assert.match(preload, /prepareWindowsRecovery:\s*\(\)\s*=>\s*ipcRenderer\.invoke/);
  assert.match(panel, /runtime\.codexRecoveryReady/);
});
