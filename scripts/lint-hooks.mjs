import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOOK_PATH = path.join(REPO_ROOT, '.husky', 'pre-commit');

const REQUIRED_TOKENS = [
  {
    token: 'CODEX_DISABLED=1',
    why: 'Without it the pre-commit hook spawns the real Codex app-server during unit tests, which fights for SQLite locks with the dev server. Observed in Phase 5b round-6: every commit wedged for 30+ minutes. Keep the hook env aligned with `npm run test:unit`.',
  },
];

function fail(messages) {
  console.error('\n[lint:hooks] FAILED — pre-commit hook is missing required guards:\n');
  for (const m of messages) {
    console.error('  - ' + m);
  }
  console.error('\nFix: edit .husky/pre-commit to include the missing token(s) above.\n');
  process.exit(1);
}

if (!fs.existsSync(HOOK_PATH)) {
  fail([`.husky/pre-commit not found at ${HOOK_PATH}`]);
}

const hook = fs.readFileSync(HOOK_PATH, 'utf8');
const missing = [];
for (const { token, why } of REQUIRED_TOKENS) {
  if (!hook.includes(token)) {
    missing.push(`Missing "${token}" — ${why}`);
  }
}

if (missing.length > 0) fail(missing);

console.log('[lint:hooks] ok — .husky/pre-commit contains all required guards.');
