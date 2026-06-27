import fs from 'node:fs';
import path from 'node:path';

/**
 * #628 — resolve an @-mention's client-supplied in-tree path to a REAL absolute
 * path, but ONLY if it stays inside the session working dir (cwd).
 *
 * Returns the real path when safe; returns null when the path is absent / escapes
 * cwd / doesn't point at an existing regular file — in which case the caller falls
 * back to writing a `.codepilot-uploads` copy (the pre-#628 behavior, which is
 * non-destructive: the AI edits a throwaway).
 *
 * NEVER trust the client path: it is resolved against `workDir` and containment-
 * checked, so a crafted attachment can't hand the AI a write path OUTSIDE the
 * project. Mirrors the cwd boundary check in `app/api/files/serve`. `originPath`
 * may be cwd-relative (the normal MentionRef path) or absolute (defensive) — both
 * are normalized by `path.resolve` and then containment-checked the same way.
 */
export function resolveInTreeAttachmentPath(
  originPath: string | undefined,
  workDir: string | undefined,
): string | null {
  if (!originPath || !workDir) return null;
  const baseResolved = path.resolve(workDir);
  const realResolved = path.resolve(workDir, originPath);
  const inside =
    realResolved === baseResolved || realResolved.startsWith(baseResolved + path.sep);
  if (!inside) return null;
  try {
    if (fs.existsSync(realResolved) && fs.statSync(realResolved).isFile()) {
      return realResolved;
    }
  } catch {
    // stat race / permission error — fall back to the copy path
  }
  return null;
}
