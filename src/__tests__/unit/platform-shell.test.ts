/**
 * #28 — Windows shell 方言。Agent（任一 Runtime）生成/展示命令时不能默认 bash/POSIX，
 * Windows 用户在 PowerShell 里复制执行会失败。getPlatformShell 解析目标 shell，
 * platformCommandGuidance 给系统提示注入方言指引——**off-Windows-PowerShell 为空字符串**，
 * 所以注入是 no-op（mac/linux/Windows-with-Git-Bash 零变化），只 Windows-without-Git-Bash 加指引。
 *
 * 真实 Windows 机器的端到端验收见 preview-build-readiness Phase 2（本地无 Windows 不能代验）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getPlatformShell, platformCommandGuidance } from '../../lib/platform';

describe('#28 getPlatformShell', () => {
  it('win32 without Git Bash → powershell', () => {
    assert.equal(getPlatformShell({ platform: 'win32', gitBashAvailable: false }), 'powershell');
  });
  it('win32 with Git Bash / WSL → bash', () => {
    assert.equal(getPlatformShell({ platform: 'win32', gitBashAvailable: true }), 'bash');
  });
  it('darwin → zsh by default, bash when $SHELL says bash', () => {
    assert.equal(getPlatformShell({ platform: 'darwin', shellEnv: '/bin/zsh' }), 'zsh');
    assert.equal(getPlatformShell({ platform: 'darwin', shellEnv: '/usr/local/bin/bash' }), 'bash');
  });
  it('linux → bash', () => {
    assert.equal(getPlatformShell({ platform: 'linux' }), 'bash');
  });
});

describe('#28 platformCommandGuidance', () => {
  it('Windows-PowerShell → PowerShell guidance that forbids bash-only + gives PS equivalents', () => {
    const g = platformCommandGuidance({ platform: 'win32', gitBashAvailable: false });
    assert.match(g, /PowerShell/);
    assert.match(g, /rm -rf|export VAR|mkdir -p/); // names the bash-only patterns to avoid
    assert.match(g, /Remove-Item|New-Item|\$env:/); // PowerShell equivalents
  });
  it('no-op (empty) on macOS / Linux / Windows-with-Git-Bash', () => {
    assert.equal(platformCommandGuidance({ platform: 'darwin' }), '');
    assert.equal(platformCommandGuidance({ platform: 'linux' }), '');
    assert.equal(platformCommandGuidance({ platform: 'win32', gitBashAvailable: true }), '');
  });
});

describe('#28 shell-dialect hint injected into Native + Codex system prompts (source-pin)', () => {
  const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8');
  it('Native (agent-system-prompt) injects platformCommandGuidance()', () => {
    assert.match(read('lib/agent-system-prompt.ts'), /platformCommandGuidance\(\)/);
  });
  it('Codex (unified-adapter) injects platformCommandGuidance()', () => {
    assert.match(read('lib/codex/proxy/unified-adapter.ts'), /platformCommandGuidance\(\)/);
  });
});
