/**
 * tools/glob.ts — Find files by pattern.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { execFileSync } from 'child_process';
import path from 'path';
import type { ToolContext } from './index';

const EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '__pycache__',
] as const;

function findFallback(cwd: string, pattern: string): string {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const basenamePattern = normalized.replace(/^\*\*\//, '');
  const predicate = basenamePattern.includes('/')
    ? ['-path', `./${basenamePattern}`]
    : ['-name', basenamePattern];
  const args = ['.', '-type', 'f', ...predicate];
  for (const directory of EXCLUDED_DIRECTORIES) {
    args.push('-not', '-path', `*/${directory}/*`);
  }
  return execFileSync('find', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export function createGlobTool(ctx: ToolContext) {
  return tool({
    description:
      'Find files matching a glob pattern. Returns file paths in stable path order. ' +
      'Use this to discover files by name pattern (e.g. "**/*.ts", "src/components/**/*.tsx").',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern to match files against'),
      path: z.string().optional().describe('Directory to search in (defaults to working directory)'),
    }),
    execute: async ({ pattern, path: searchPath }) => {
      const cwd = searchPath
        ? (path.isAbsolute(searchPath) ? searchPath : path.resolve(ctx.workingDirectory, searchPath))
        : ctx.workingDirectory;

      try {
        const args = ['--files', '--color=never', '--glob', pattern];
        for (const directory of EXCLUDED_DIRECTORIES) {
          args.push('--glob', `!${directory}/**`, '--glob', `!**/${directory}/**`);
        }
        let result: string;
        try {
          result = execFileSync('rg', args, {
            cwd,
            encoding: 'utf-8',
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
          });
        } catch (error) {
          const processError = error as NodeJS.ErrnoException & { status?: number };
          if (processError.status === 1) {
            result = '';
          } else if (processError.code === 'ENOENT') {
            result = findFallback(cwd, pattern);
          } else {
            throw error;
          }
        }

        const files = result.trim().split('\n').filter(Boolean).sort().slice(0, 200);
        if (files.length === 0) {
          return `No files found matching pattern "${pattern}" in ${cwd}`;
        }

        return files.join('\n');
      } catch {
        return `Error searching for files matching "${pattern}" in ${cwd}`;
      }
    },
  });
}
