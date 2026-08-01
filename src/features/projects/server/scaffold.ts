// Creates the `.fleetview/` report directory in watched repos and agent worktrees.
//
// This is FleetView's job, not the agent's. The skill used to ask Claude to run
// the mkdir and write the inner .gitignore itself, which made the on-disk layout
// a matter of model compliance: a session that skipped those two prose rules left
// an unignored `.fleetview/` sitting in `git status`. The layout is a contract
// between FleetView and the files FleetView reads, so FleetView creates it — the
// skill only fills in content.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Directory name agents report into. Mirrors the adapter's read paths:
 *  `<cwd>/.fleetview/sessions/<id>.json` and `<worktree>/.fleetview/plan.json`. */
export const REPORT_DIR = '.fleetview';

/**
 * Directories scaffolded during this process's lifetime.
 *
 * The caller is on the /api/fleet poll (every 2.5s), where the repo and worktree
 * sets are near-constant — re-running the syscalls each time is pure waste. The
 * tradeoff is that deleting `.fleetview/` by hand while FleetView runs is not
 * noticed until restart, which is the same deal `metaCache` already takes.
 */
const scaffolded = new Set<string>();

/**
 * Ensure `<dir>/.fleetview/sessions/` exists and that the directory ignores itself.
 *
 * The inner `.gitignore` (a single `*`) hides reports from git without touching
 * the repo's own `.gitignore` — nothing to commit, nothing to review, and it
 * behaves identically in a worktree and in the repo root.
 *
 * Deliberately never creates `dir` itself. A watched-repo entry pointing at a
 * since-deleted directory should stay deleted, not be resurrected as an empty
 * tree containing only our scratch dir.
 */
export async function ensureReportDir(dir: string): Promise<void> {
  if (!dir || scaffolded.has(dir)) return;
  try {
    if (!(await stat(dir)).isDirectory()) return;
    await mkdir(path.join(dir, REPORT_DIR, 'sessions'), { recursive: true });
    // 'wx' throws when the file already exists, so a copy someone edited (or an
    // older agent-written one) is left alone rather than silently rewritten.
    await writeFile(path.join(dir, REPORT_DIR, '.gitignore'), '*\n', { flag: 'wx' })
      .catch(() => { /* already present */ });
    scaffolded.add(dir);
  } catch {
    // Missing, unreadable, or read-only: reporting degrades to nothing for this
    // repo. Never fatal — FleetView's job is to observe, not to require write access.
  }
}

/** Scaffold many directories at once, skipping blanks and duplicates. */
export async function ensureReportDirs(dirs: Iterable<string | null | undefined>): Promise<void> {
  const unique = new Set<string>();
  for (const d of dirs) if (d) unique.add(d);
  await Promise.all([...unique].map(ensureReportDir));
}
