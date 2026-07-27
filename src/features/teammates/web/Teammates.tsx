import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Teammate } from '../../../lib/claude-adapter/types';
import { rosterOf, rosterIdentity, shouldCollapseFinished } from '../shared/roster';
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
}

/** Live per-agent activity surface for a session. Lead pinned first, agents that
    have finished collapsed behind a disclosure so they can't bury the active ones.
    Pure presentational: props in, no fetching — the caller wires callbacks. */
export function Teammates({ members, onApprove, onRequestChanges, approvable = true }: TeammatesProps) {
  const list = members ?? [];
  const { active, finished } = useMemo(() => rosterOf(list), [list]);
  const identity = useMemo(() => rosterIdentity(list), [list]);
  const bodyId = useId();

  // A user's toggle always wins; the default only re-latches for a different
  // session, so the 2.5s poll can't re-collapse the group under the cursor.
  const [collapsed, setCollapsed] = useState(() => shouldCollapseFinished(finished.length));
  const latched = useRef(identity);
  useEffect(() => {
    if (latched.current === identity) return;
    latched.current = identity;
    setCollapsed(shouldCollapseFinished(finished.length));
  }, [identity, finished.length]);

  if (list.length === 0) {
    return <p className="tm-empty">No agents in this session yet.</p>;
  }

  const row = (m: Teammate) => (
    <TeammateRow
      key={m.agentId}
      m={m}
      onApprove={onApprove}
      onRequestChanges={onRequestChanges}
      approvable={approvable}
    />
  );

  return (
    <div className="tm-list">
      {active.map(row)}

      {finished.length > 0 && (
        <section className="tm-finished" aria-label="Finished agents">
          <button
            type="button"
            className="tm-finished-toggle"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={() => setCollapsed((c) => !c)}
          >
            <span className="tm-chevron" aria-hidden="true" />
            <span className="tm-finished-title">Finished</span>
            <span className="tm-finished-count mono">{finished.length}</span>
            <span className="tm-finished-hint">{collapsed ? 'Show' : 'Hide'}</span>
          </button>
          <div className="tm-finished-body" id={bodyId} hidden={collapsed}>
            {finished.map(row)}
          </div>
        </section>
      )}
    </div>
  );
}
