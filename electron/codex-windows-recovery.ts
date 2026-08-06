import path from 'node:path';

export const CODEX_WINDOWS_INSTALL_COMMAND = 'irm https://chatgpt.com/codex/install.ps1 | iex';

export interface CodexPowerShellLaunchSpec {
  command: string;
  args: string[];
  windowsHide: false;
  shell: false;
}

/** Fixed executable + fixed argv. No renderer-controlled command is accepted. */
export function buildCodexPowerShellLaunchSpec(
  platform: NodeJS.Platform = process.platform,
  systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
): CodexPowerShellLaunchSpec {
  if (platform !== 'win32') throw new Error('unsupported_platform');
  return {
    command: path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoExit'],
    windowsHide: false,
    shell: false,
  };
}

export function isTrustedCodexRecoverySender(senderUrl: string, expectedPort: number | null): boolean {
  try {
    const parsed = new URL(senderUrl);
    return parsed.protocol === 'http:'
      && parsed.hostname === '127.0.0.1'
      && expectedPort !== null
      && parsed.port === String(expectedPort);
  } catch {
    return false;
  }
}
