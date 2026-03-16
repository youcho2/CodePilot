import { NextResponse } from 'next/server';
import { findClaudeBinary, getClaudeVersion, findAllClaudeBinaries, classifyClaudePath, isWindows, findGitBash } from '@/lib/platform';
import type { ClaudeInstallInfo } from '@/lib/platform';

/** Minimum CLI versions for optional features */
const FEATURE_MIN_VERSIONS: Record<string, string> = {
  thinking: '1.0.10',
  context1m: '1.0.20',
  effort: '1.0.15',
};

/** Compare two semver-like version strings. Returns true if a >= b */
function versionGte(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return true;
}

export async function GET() {
  try {
    const claudePath = findClaudeBinary();

    // On Windows, check for Git Bash (bash.exe) using the same detection as the SDK runtime.
    // This avoids false negatives when Git is installed but git.exe isn't on PATH.
    const missingGit = isWindows && findGitBash() === null;

    if (!claudePath) {
      return NextResponse.json({ connected: false, version: null, binaryPath: null, installType: null, otherInstalls: [], missingGit, features: {} });
    }
    const version = await getClaudeVersion(claudePath);
    const installType = classifyClaudePath(claudePath);

    // Detect other installations for conflict warning
    let otherInstalls: ClaudeInstallInfo[] = [];
    try {
      const all = findAllClaudeBinaries();
      otherInstalls = all.filter(i => i.path !== claudePath);
    } catch {
      // non-critical — don't fail the status check
    }

    // Detect supported features based on CLI version
    const features: Record<string, boolean> = {};
    if (version) {
      for (const [feature, minVersion] of Object.entries(FEATURE_MIN_VERSIONS)) {
        features[feature] = versionGte(version, minVersion);
      }
    }

    return NextResponse.json({
      // If Git Bash is missing on Windows, Claude is installed but not usable
      connected: !!version && !missingGit,
      version,
      binaryPath: claudePath,
      installType,
      otherInstalls,
      missingGit,
      features,
    });
  } catch {
    return NextResponse.json({ connected: false, version: null, binaryPath: null, installType: null, otherInstalls: [], missingGit: false, features: {} });
  }
}
