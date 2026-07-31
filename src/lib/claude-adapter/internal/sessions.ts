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
import { readDigest } from './digest';
import type { LiveSession, KnownSession, SessionDigest } from '../types';

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

// Spawning the CLI is expensive — measured 1.6s cold, ~320ms warm, because it
// boots a 250MB binary. It dominated /api/fleet, which the UI polls every 2.5s.
//
// A plain TTL cache does NOT fix this: the call takes longer than any TTL short
// enough to feel live, so nearly every poll missed and paid full price. Use
// stale-while-revalidate instead — serve the last known answer instantly and
// refresh in the background. Data is then at most one poll old, which is exactly
// the freshness the 2.5s poll already implied, at ~0ms.
//
// Keyed by cwd because `--cwd` changes the result.
const TTL_MS = 2000;

interface Entry<T> { at: number; value: T | null; inflight: Promise<T> | null }

/**
 * Stale-while-revalidate memo, shared by both discovery sources.
 *
 * Only the very first caller ever waits. After that, callers get the last known
 * answer instantly and a refresh runs in the background, so data is at most one
 * poll old — exactly the freshness the 2.5s poll already implied.
 */
function swr<T>(cache: Map<string, Entry<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let e = cache.get(key);
  if (!e) cache.set(key, e = { at: 0, value: null, inflight: null });

  const fresh = e.value !== null && Date.now() - e.at < TTL_MS;
  if (!fresh && !e.inflight) {
    const entry = e;
    entry.inflight = load()
      .then(v => { entry.value = v; entry.at = Date.now(); return v; })
      .catch(() => entry.value as T)
      .finally(() => { entry.inflight = null; });
  }
  return e.value !== null ? Promise.resolve(e.value) : e.inflight!;
}

const liveCache = new Map<string, Entry<LiveSession[]>>();
const knownCache = new Map<string, Entry<KnownSession[]>>();

/**
 * Live Claude Code sessions, optionally scoped to a repo.
 *
 * Never throws: a missing/failed `claude` binary yields `[]` so the monitor
 * plane degrades to disk-only discovery rather than breaking the fleet poll.
 */
export function liveSessions(cwd?: string): Promise<LiveSession[]> {
  return swr(liveCache, cwd ?? '', () => liveSessionsUncached(cwd));
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
export function knownSessions(dir: string, limit = 50): Promise<KnownSession[]> {
  // Measured at ~220ms per repo — the single largest remaining cost in a fleet
  // poll once the CLI call is cached. The set of sessions on disk barely changes,
  // so the same stale-while-revalidate treatment applies.
  return swr(knownCache, `${dir} ${limit}`, () => knownSessionsUncached(dir, limit));
}

async function knownSessionsUncached(dir: string, limit: number): Promise<KnownSession[]> {
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
 * Locate a session's transcript, then digest it.
 *
 * Lives here rather than in digest.ts so path resolution stays with the other
 * `~/.claude` layout knowledge. `cwd` makes it a direct hit; without one we scan
 * project dirs, which is only needed for a session we haven't placed yet.
 */
export async function readSessionDigest(sessionId: string, cwd?: string | null): Promise<SessionDigest> {
  let hit: string | null = null;
  if (cwd) {
    const direct = path.join(PROJECTS, encodeCwd(cwd), `${sessionId}.jsonl`);
    try { await stat(direct); hit = direct; } catch { /* fall through to the scan */ }
  }
  if (!hit) {
    let dirs: string[] = [];
    try {
      dirs = (await readdir(PROJECTS, { withFileTypes: true }))
        .filter(d => d.isDirectory()).map(d => d.name);
    } catch { /* no projects dir */ }
    for (const d of dirs) {
      const p = path.join(PROJECTS, d, `${sessionId}.jsonl`);
      try { await stat(p); hit = p; break; } catch { /* keep looking */ }
    }
  }
  return readDigest(hit, { cwd, sessionId });
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

  const target = `agent-${agentId}.jsonl`;
  for (const sid of candidates) {
    const subagentsDir = path.join(projectDir, sid, 'subagents');
    if (await findFileRecursive(subagentsDir, target)) return sid;
  }
  return null;
}

async function findFileRecursive(dir: string, filename: string): Promise<boolean> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === filename) return true;
    if (entry.isDirectory()) {
      if (await findFileRecursive(path.join(dir, entry.name), filename)) return true;
    }
  }
  return false;
}
