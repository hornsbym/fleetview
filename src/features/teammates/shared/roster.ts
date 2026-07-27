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
 * "Finished" means the agent has RETURNED or been dismissed — not that it's quiet.
 *
 * That distinction is the whole point: an idle or waiting agent is still spawned
 * and still yours to attend to, so it must stay visible. Only agents that are
 * genuinely gone get dropped. Silence is used as evidence only when the definitive
 * signal is unavailable.
 *
 * The lead is never finished — it IS the session, and a session with a quiet lead
 * is idle, not over.
 */
export interface SessionState {
  /** The session process is running. */
  live?: boolean;
  /** From `claude agents --json`: 'busy' | 'idle' | 'waiting' | 'shell'. */
  status?: string | null;
}

export function isFinished(m: Teammate, session: SessionState = {}): boolean {
  if (m.isLead) return false;

  if (session.live === false) return true;

  // An agent can be resumed after returning its tool_result. If its transcript
  // is still being written to (!stale), it's actively working regardless of
  // whether the original tool_result was received.
  if (m.finished === true && !m.stale) return false;

  if (m.finished !== null) return m.finished;

  return false;
}

/** Split a member list into what's running and what's done. Lead(s) pinned first;
 *  sort is stable, so incoming order is otherwise preserved. */
export function rosterOf(members: Teammate[], session: SessionState = {}): Roster {
  const all = [...(members ?? [])].sort((a, b) => Number(b.isLead) - Number(a.isLead));
  return {
    active: all.filter(m => !isFinished(m, session)),
    finished: all.filter(m => isFinished(m, session)),
  };
}

