import type { Teammate } from '../../../lib/claude-adapter/types';
import { TeammateRow } from './TeammateRow';
import './Teammates.css';

export interface TeammatesProps {
  members: Teammate[];
  /** Approve a plan-gated agent's plan. Row buttons hide when this is absent. */
  onApprove?: (m: Teammate) => void;
  /** Ask a plan-gated agent to revise its plan. Secondary button hides when absent. */
  onRequestChanges?: (m: Teammate) => void;
  /** False disables the approval buttons (FleetView has no running orchestrator for
   *  this repo, so approving would misfire). Defaults to enabled. */
  approvable?: boolean;
}

/** Live per-agent activity surface for a session. Lead pinned first.
    Pure presentational: props in, no fetching — the caller wires callbacks. */
export function Teammates({ members, onApprove, onRequestChanges, approvable = true }: TeammatesProps) {
  if (!members || members.length === 0) {
    return <p className="tm-empty">No agents in this session yet.</p>;
  }

  // Lead(s) first; sort is stable so incoming order is otherwise preserved.
  const ordered = [...members].sort((a, b) => Number(b.isLead) - Number(a.isLead));

  return (
    <div className="tm-list">
      {ordered.map((m) => (
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
