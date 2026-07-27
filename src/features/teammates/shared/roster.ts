// Roster derivation: who's actually working vs. who already finished, plus the
// collapse policy for the finished group. Pure functions, mirroring
// task-board/shared/board-progress.ts so both surfaces behave the same way.
import type { Teammate } from '../../../lib/claude-adapter/types';

export interface Roster {
  /** Lead(s) first, then agents still working. Always visible. */
  active: Teammate[];
  /** Agents whose transcript has gone quiet — done, or abandoned. */
  finished: Teammate[];
}

/** Finished lists at or above this size start collapsed, so a long tail of
 *  one-off helpers can't bury the agents actually doing something. */
export const FINISHED_COLLAPSE_MIN = 3;

export function shouldCollapseFinished(finishedCount: number): boolean {
  return finishedCount >= FINISHED_COLLAPSE_MIN;
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
export function isFinished(m: Teammate): boolean {
  if (m.isLead) return false;
  if (m.phase === 'working' || m.phase === 'awaiting-approval' || m.phase === 'blocked') return false;
  return m.stale;
}

/** Split a member list into what's live and what's done. Lead(s) pinned first;
 *  sort is stable, so incoming order is otherwise preserved. */
export function rosterOf(members: Teammate[]): Roster {
  const all = [...(members ?? [])].sort((a, b) => Number(b.isLead) - Number(a.isLead));
  return {
    active: all.filter(m => !isFinished(m)),
    finished: all.filter(isFinished),
  };
}

/** Stable identity for "is this the same roster?" — order-independent, so a
 *  re-sort or a newly-spawned agent can't reset the user's collapse choice.
 *  Only switching sessions does. */
export function rosterIdentity(members: Teammate[]): string {
  let lowest = '';
  for (const m of members ?? []) {
    if (lowest === '' || m.agentId < lowest) lowest = m.agentId;
  }
  return lowest;
}
