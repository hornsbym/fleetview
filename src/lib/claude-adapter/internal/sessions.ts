// Session discovery. The Claude Code session is the source of truth; FleetView
// only observes it. Two sources, merged by canonical session id:
//
//   1. `claude agents --json` — LIVE sessions (interactive + background), with
//      real liveness (`status`, `waitingFor`) that depends on neither team files
//      nor FleetView owning anything. TTY-free and scriptable.
//   2. The SDK's `listSessions({ dir })` — every session on disk for a repo,
//      live or past.
//
// Neither depends on `~/.claude/tasks` or `~/.claude/teams`, which is why this
// module — not those directories — is the primary discovery path.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { PROJECTS, encodeCwd } from './paths';
import type { LiveSession, KnownSession } from '../types';

const pexec = promisify(execFile);

// `claude agents --json` shape as of CLI 2.1.220. Verified: exits without a TTY,
// honours --cwd, and includes SDK-spawned sessions (entrypoint `sdk-ts`).
// `status`/`waitingFor`/`state` are absent until the session reports a state, so
// every consumer must treat them as optional.
interface RawAgentSession {
  pid?: number;
  id?: string; // background job id, e.g. "7b47770f"
  sessionId?: string;
  cwd?: string;
  kind?: string; // "interactive" | "background"
  name?: string;
  startedAt?: number;
  status?: string; // "busy" | "idle" | "waiting" | "shell"
  waitingFor?: string; // e.g. "permission prompt", "dialog open"
  state?: string; // "working" | "blocked" | …
}

// Spawning the CLI costs ~0.3s. The fleet poll runs every 2.5s PER OPEN TAB, so
// without this every tab pays for its own subprocess ~24×/minute. A sub-poll TTL
// collapses concurrent callers onto one in-flight invocation while keeping the UI
// effectively live. Keyed by cwd because `--cwd` changes the result.
const LIVE_TTL_MS = 1000;
const liveCache = new Map<string, { at: number; p: Promise<LiveSession[]> }>();

/**
 * Live Claude Code sessions, optionally scoped to a repo.
 *
 * Never throws: a missing/failed `claude` binary yields `[]` so the monitor
 * plane degrades to disk-only discovery rather than breaking the fleet poll.
 */
export function liveSessions(cwd?: string): Promise<LiveSession[]> {
  const key = cwd ?? '';
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.p;
  const p = liveSessionsUncached(cwd);
  liveCache.set(key, { at: Date.now(), p });
  return p;
}

async function liveSessionsUncached(cwd?: string): Promise<LiveSession[]> {
  const args = ['agents', '--json'];
  if (cwd) args.push('--cwd', cwd);
  let stdout: string;
  try {
    ({ stdout } = await pexec('claude', args, { maxBuffer: 1 << 20, timeout: 10_000 }));
  } catch {
    return [];
  }
  let raw: unknown;
  try { raw = JSON.parse(stdout); } catch { return []; }
  if (!Array.isArray(raw)) return [];

  const out: LiveSession[] = [];
  for (const r of raw as RawAgentSession[]) {
    if (!r?.sessionId || !r.cwd) continue;
    out.push({
      sessionId: r.sessionId,
      pid: r.pid ?? null,
      cwd: r.cwd,
      kind: r.kind === 'background' ? 'background' : 'interactive',
      name: r.name ?? null,
      startedAt: r.startedAt ?? null,
      status: r.status ?? null,
      waitingFor: r.waitingFor ?? null,
      state: r.state ?? null,
      jobId: r.id ?? null,
    });
  }
  return out;
}

/**
 * Every session on disk for a repo (live or past), newest first.
 * Never throws — returns `[]` when the project has no history.
 *
 * Note this EXCLUDES programmatic/SDK-entrypoint sessions by default, so it is not
 * a superset of `liveSessions()`: an SDK-spawned session appears in
 * `claude agents --json` but not here, and therefore has no `summary` to name it.
 * That's why both sources are merged rather than either being preferred outright.
 */
export async function knownSessions(dir: string, limit = 50): Promise<KnownSession[]> {
  try {
    const rows = await listSessions({ dir, limit });
    return rows.map(s => ({
      sessionId: s.sessionId,
      summary: s.customTitle || s.summary || s.firstPrompt || '',
      cwd: s.cwd ?? dir,
      gitBranch: s.gitBranch ?? null,
      lastModified: s.lastModified ?? null,
      createdAt: s.createdAt ?? null,
    }));
  } catch {
    return [];
  }
}

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve any of Claude Code's session-id spellings to the canonical full UUID.
 *
 * There is only ONE identifier — the session id — but task directories spell it
 * two ways: the full UUID, or `session-<first 8 hex>` (verified: `session-2211c310`
 * is `2211c310-1989-46ed-be98-73382241f378`). A truncated id that matches nothing
 * known is an orphan — a dead session whose transcript was cleaned up — and
 * resolves to `null` so callers can drop it rather than render a ghost tile.
 *
 * `known` should be every session id in play (live + on-disk).
 */
export function canonicalSessionId(raw: string, known: Iterable<string>): string | null {
  if (!raw) return null;
  if (FULL_UUID.test(raw)) return raw.toLowerCase();

  const prefix = (raw.startsWith('session-') ? raw.slice('session-'.length) : raw).toLowerCase();
  if (!prefix) return null;

  let hit: string | null = null;
  for (const k of known) {
    if (!k.toLowerCase().startsWith(prefix)) continue;
    if (hit && hit !== k) return null; // ambiguous — refuse to guess
    hit = k;
  }
  return hit;
}

/** True when a live session is parked waiting on a human. */
export function isWaiting(s: LiveSession): boolean {
  return s.status === 'waiting' || s.state === 'blocked';
}

/**
 * Find the parent session of a subagent, given the agent id from a
 * `PermissionRequest` hook payload.
 *
 * Needed because a subagent's hook reports the SUBAGENT's own `session_id`, not
 * its parent's (verified: a general-purpose subagent's Write reported a distinct
 * session id from the session that spawned it). Without this, a teammate's
 * permission card cannot be grouped under the session page you're looking at.
 *
 * The link is on disk: the parent session owns `<parent>/subagents/agent-<id>.jsonl`.
 */
export async function resolveParentSession(cwd: string, agentId: string): Promise<string | null> {
  if (!cwd || !agentId) return null;
  const projectDir = path.join(PROJECTS, encodeCwd(cwd));
  let candidates: string[];
  try {
    candidates = (await readdir(projectDir, { withFileTypes: true }))
      .filter(d => d.isDirectory()).map(d => d.name);
  } catch { return null; }

  for (const sid of candidates) {
    try {
      await stat(path.join(projectDir, sid, 'subagents', `agent-${agentId}.jsonl`));
      return sid;
    } catch { /* not this one */ }
  }
  return null;
}
