import type { Teammate } from '../../../lib/claude-adapter/types';
import { rosterOf } from '../shared/roster';
import { TeammateRow } from './TeammateRow';
import './Teammates.css';

export interface TeammatesProps {
  members: Teammate[];
  /** Approve a plan-gated agent's plan. Row buttons hide when this is absent. */
  onApprove?: (m: Teammate) => void;
  /** Ask a plan-gated agent to revise its plan. Secondary button hides when absent. */
  onRequestChanges?: (m: Teammate) => void;
  /** False disables the approval buttons. Defaults to enabled. */
  approvable?: boolean;
  /** Whether the session is running. A stopped session has no working agents. */
  live?: boolean;
}

/**
 * Live per-agent activity surface for a session. Lead pinned first.
 *
 * Shows only agents that are actually running. Agents that have finished are
 * deliberately NOT rendered — this panel answers "who is working right now", and
 * a session that spawned twenty one-off helpers over an hour would otherwise bury
 * that answer under a list of the dead. The adapter still reports them (servers
 * report, UIs decide), so a history view can surface them later if it's ever
 * wanted.
 *
 * Pure presentational: props in, no fetching — the caller wires callbacks.
 */
export function Teammates({ members, onApprove, onRequestChanges, approvable = true, live = true }: TeammatesProps) {
  const { active } = rosterOf(members ?? [], live);

  if (active.length === 0) {
    return <p className="tm-empty">No agents working in this session.</p>;
  }

  return (
    <div className="tm-list">
      {active.map((m) => (
        <TeammateRow
          key={m.agentId}
          m={m}
          onApprove={onApprove}
          onRequestChanges={onRequestChanges}
          approvable={approvable}
        />
      ))}
    </div>
  );
}
