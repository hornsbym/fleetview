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

/** Monitor plane: a normalized snapshot of every project/session/teammate.
 *  `pending` carries the hook bridge's parked permission counts per session — the
 *  only live fact not derivable from Claude Code's own state. */
export async function readFleet(config: FleetConfig = {}, pending?: PendingSnapshot): Promise<Fleet> {
  return buildFleet(config, pending);
}

/** Installed Claude Code version — used for graceful degradation later. */
export function claudeVersion(): string {
  try { return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}
