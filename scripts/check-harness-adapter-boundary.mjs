#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';

function valuesFor(flag) {
  const values = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

const base = valuesFor('--base')[0];
const adapterId = valuesFor('--adapter-id')[0];
const explicitAllow = valuesFor('--allow');

if (!base || !adapterId) {
  console.error(
    'Usage: node scripts/check-harness-adapter-boundary.mjs '
    + '--base <explicit-commit> --adapter-id <id> [--allow <path>]...',
  );
  process.exit(2);
}
if (!/^[A-Za-z0-9._-]+$/.test(adapterId)) {
  console.error(`Invalid adapter id: ${adapterId}`);
  process.exit(2);
}

try {
  execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
    stdio: 'ignore',
  });
} catch {
  console.error(`Base commit is not resolvable: ${base}`);
  process.exit(2);
}

const changed = execFileSync(
  'git',
  ['diff', '--name-only', `${base}...HEAD`],
  { encoding: 'utf8' },
)
  .split(/\r?\n/)
  .filter(Boolean);

const adapterPrefix = path.posix.join(
  'src/lib/harness-home/adapters',
  adapterId,
) + '/';
const fixedAllow = new Set([
  'src/lib/harness-home/adapters/registry.ts',
  'src/__tests__/unit/harness-home-adapter-conformance.test.ts',
  ...explicitAllow,
]);
const violations = changed.filter((file) =>
  !file.startsWith(adapterPrefix) && !fixedAllow.has(file));

if (violations.length > 0) {
  console.error(
    `Harness adapter boundary failed for "${adapterId}" from ${base}:\n`
    + violations.map((file) => `  - ${file}`).join('\n'),
  );
  process.exit(1);
}

console.log(
  `[harness-adapter-boundary] ok — ${adapterId}; `
  + `${changed.length} changed file(s), explicit base ${base}`,
);
