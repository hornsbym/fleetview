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

  // A session that isn't running has no running agents, whatever they last said
  // about themselves. `.fleetview/plan.json` is a file, not a heartbeat: an agent
  // that wrote `phase: "working"` and then died leaves that claim on disk forever.
  if (session.live === false) return true;

  // An IDLE parent is awaiting your input, and subagents only run inside a turn —
  // so nothing of its can still be running. This catches agents that were
  // interrupted rather than completed: those never receive a tool_result, so the
  // signal below would call them alive indefinitely. Note 'waiting' is expressly
  // NOT idle — a subagent may be the thing blocked on a permission prompt.
  if (session.status === 'idle') return true;

  // Definitive: the spawning tool call received its result, so the agent returned
  // or was dismissed. An agent that has NOT returned is still alive — it may be
  // idle or waiting on a prompt, and those must stay visible.
  if (m.finished !== null) return m.finished;

  // Only when completion is unknowable (no toolUseId in meta.json) do we fall back
  // to silence as a proxy — which is a guess, and says so.
  return m.stale;
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

