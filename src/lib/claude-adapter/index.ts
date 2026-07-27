// @fleetview/claude-adapter — the ONLY module allowed to touch Claude Code's
// on-disk state, transcripts, or CLI. Features consume this typed interface and
// never reach past it. If Claude Code changes its internals, this is the edit.
//
// This interface is READ-ONLY by design. FleetView visualizes Claude Code
// sessions; the terminal session is the source of truth. There is deliberately
// no way to spawn, message, resume or stop a session from here — see PLAN.md.
import { execFileSync } from 'node:child_process';
import { buildFleet } from './internal/fleet';
import type { PendingSnapshot, Fleet, FleetConfig } from './types';

export * from './types';
export { readSessionHistory, readSubagentHistory } from './internal/history';
export { liveSessions, knownSessions, canonicalSessionId, isWaiting, resolveParentSession } from './internal/sessions';

// Building the fleet costs a few hundred ms — it walks every session, every
// subagent dir and every worktree. Node is single-threaded, so paying that on the
// request path meant the 2.5s fleet poll periodically stalled everything else the
// UI asked for (measured: /api/session/history jumping from 31ms to ~500ms while a
// build was in flight). That reads as intermittent lag on a session page.
//
// So: serve the last snapshot immediately and rebuild in the background. Freshness
// is unchanged in practice — the data was already at most one poll old — but no
// request ever waits behind a build, and N open tabs share one build instead of
// each triggering their own.
const FLEET_TTL_MS = 1500;
let fleetAt = 0;
let fleetValue: Fleet | null = null;
let fleetInflight: Promise<Fleet> | null = null;

function cachedFleet(config: FleetConfig): Promise<Fleet> {
  const fresh = fleetValue && Date.now() - fleetAt < FLEET_TTL_MS;
  if (!fresh && !fleetInflight) {
    fleetInflight = buildFleet(config)
      .then(f => { fleetValue = f; fleetAt = Date.now(); return f; })
      .catch(e => { if (fleetValue) return fleetValue; throw e; })
      .finally(() => { fleetInflight = null; });
  }
  return fleetValue ? Promise.resolve(fleetValue) : fleetInflight!;
}

/**
 * Apply the hook bridge's parked-permission counts to a (possibly cached) fleet.
 *
 * Deliberately NOT part of the cached build: an approval request must show up on
 * the very next poll, not whenever the snapshot happens to refresh. Cheap enough
 * to redo per request, and never mutates the cached objects.
 */
function withPending(fleet: Fleet, pending?: PendingSnapshot): Fleet {
  const counts = pending?.pendingBySession;
  if (!counts || Object.keys(counts).length === 0) return fleet;
  return {
    ...fleet,
    projects: fleet.projects.map(p => ({
      ...p,
      sessions: p.sessions.map(s => {
        const n = counts[s.id] ?? 0;
        return n === s.pendingApprovals ? s : { ...s, pendingApprovals: n, needsApproval: n > 0 };
      }),
    })),
  };
}

/** Monitor plane: a normalized snapshot of every project/session/teammate.
 *  `pending` carries the hook bridge's parked permission counts per session — the
 *  only live fact not derivable from Claude Code's own state. */
export async function readFleet(config: FleetConfig = {}, pending?: PendingSnapshot): Promise<Fleet> {
  return withPending(await cachedFleet(config), pending);
}

/** Installed Claude Code version — used for graceful degradation later. */
export function claudeVersion(): string {
  try { return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}
