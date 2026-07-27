// Roster derivation: who's actually working vs. who already finished.
// Pure functions; the UI renders `active` only.
import type { Teammate } from '../../../lib/claude-adapter/types';

export interface Roster {
  /** Lead(s) first, then agents still working. This is what the UI renders. */
  active: Teammate[];
  /** Agents whose transcript has gone quiet — done, or abandoned. Reported for
   *  completeness (and a possible future history view); not currently displayed. */
  finished: Teammate[];
}

/**
 * "Finished" is a non-lead agent whose transcript is stale AND which reports no
 * self-declared working phase.
 *
 * The lead is never finished — it IS the session, and a session with a quiet lead
 * is simply idle, not over. A plan-gated agent that says it's `working` or
 * `awaiting-approval` is likewise never hidden, even if its transcript has gone
 * quiet: `awaiting-approval` is precisely the state that needs a human, and
 * hiding it would bury the thing the user most needs to see.
 */
export function isFinished(m: Teammate, sessionLive = true): boolean {
  if (m.isLead) return false;

  // A session that isn't running has no running agents, whatever they last said
  // about themselves. `.fleetview/plan.json` is a file, not a heartbeat: an agent
  // that wrote `phase: "working"` and then died leaves that claim on disk forever.
  // Trusting it made long-dead sessions display busy-looking teammates.
  if (!sessionLive) return true;

  if (m.phase === 'working' || m.phase === 'awaiting-approval' || m.phase === 'blocked') return false;
  return m.stale;
}

/** Split a member list into what's running and what's done. Lead(s) pinned first;
 *  sort is stable, so incoming order is otherwise preserved. */
export function rosterOf(members: Teammate[], sessionLive = true): Roster {
  const all = [...(members ?? [])].sort((a, b) => Number(b.isLead) - Number(a.isLead));
  return {
    active: all.filter(m => !isFinished(m, sessionLive)),
    finished: all.filter(m => isFinished(m, sessionLive)),
  };
}

