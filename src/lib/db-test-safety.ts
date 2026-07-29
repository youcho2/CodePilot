import path from 'node:path';

interface TestProcessLike {
  env: Readonly<Record<string, string | undefined>>;
  argv: readonly string[];
  execArgv: readonly string[];
}

export function isDefaultCodePilotDataDir(
  configuredDataDir: string | undefined,
  homeDir: string,
): boolean {
  const defaultDataDir = path.join(homeDir, '.codepilot');
  const resolvedDataDir = configuredDataDir || defaultDataDir;
  return path.resolve(resolvedDataDir) === path.resolve(defaultDataDir);
}

export function isTestRunnerProcess(processLike: TestProcessLike): boolean {
  const args = [...processLike.argv, ...processLike.execArgv];
  return (
    processLike.env.NODE_ENV === 'test' ||
    !!processLike.env.VITEST ||
    !!processLike.env.JEST_WORKER_ID ||
    args.some((arg) =>
      arg === '--test' || arg.endsWith('.test.ts') || arg.endsWith('.test.js')
    )
  );
}

export function shouldRefuseRealDbFromTest(
  configuredDataDir: string | undefined,
  homeDir: string,
  processLike: TestProcessLike,
): boolean {
  return (
    isDefaultCodePilotDataDir(configuredDataDir, homeDir) &&
    isTestRunnerProcess(processLike)
  );
}
