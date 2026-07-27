// The orientation panels for a session: enough to re-enter a session's context
// after being away, without reading the transcript.
//
//   • NowPanel  — 1-3 sentences on the conceptual work in flight. Never a command.
//   • DonePanel — the running list of what this session has accomplished.
//
// Both prefer the agent's own account (`.fleetview/sessions/<id>.json`) and fall
// back to what can be derived from the transcript.
import type { Milestone, SessionDigest } from '../shared/events';
import './SessionDigest.css';

function ago(at: string | null): string {
  if (!at) return '';
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

const KIND_LABEL: Record<Milestone['kind'], string> = {
  reported: '•',
  commit: 'commit',
  task: 'task',
  plan: 'plan',
  compaction: 'compact',
};

export function NowPanel({ digest, live }: { digest: SessionDigest | null; live: boolean }) {
  return (
    <section className="dg dg-now" aria-label="What this agent is working on now">
      <div className="dg-head">
        <h3>Working on now</h3>
        {live && <span className="dg-pulse" aria-hidden="true" />}
        {digest?.reported && <span className="dg-src" title="Reported by the agent itself">self-reported</span>}
      </div>

      {digest?.now
        ? <p className="dg-prose">{digest.now}</p>
        : <p className="dg-none">{live ? 'Nothing reported yet.' : 'This session is not running.'}</p>}

      {digest?.lastRequest && (
        <div className="dg-goal">
          <span className="dg-goal-label">Working toward</span>
          <span className="dg-goal-text" title={digest.lastRequest}>{digest.lastRequest}</span>
        </div>
      )}

      {digest && (digest.tools > 0 || digest.edits > 0) && (
        <div className="dg-counts">
          <span>{digest.tools} tool calls</span>
          <span>{digest.edits} file edits</span>
          {digest.compactions > 0 && <span>{digest.compactions}× compacted</span>}
        </div>
      )}
    </section>
  );
}

export function DonePanel({ digest }: { digest: SessionDigest | null }) {
  // Ordering is already right from the adapter: a self-reported list keeps the
  // agent's own order (a narrative), derived milestones come newest-first (a log).
  const items = digest?.done ?? [];

  return (
    <section className="dg dg-done" aria-label="What this session has completed">
      <div className="dg-head">
        <h3>Done so far</h3>
        {items.length > 0 && <span className="dg-count mono">{items.length}</span>}
        {digest?.reported && <span className="dg-src" title="Maintained by the agent itself">self-reported</span>}
      </div>

      {items.length === 0 ? (
        <p className="dg-none">
          Nothing yet. Agents that keep <code>.fleetview/sessions/&lt;id&gt;.json</code> current
          list their progress here; otherwise commits and finished tasks appear.
        </p>
      ) : (
        <ul className="dg-list">
          {items.map((m, i) => (
            <li key={i} className={`dg-item dg-${m.kind}`}>
              <span className="dg-kind">{KIND_LABEL[m.kind] ?? m.kind}</span>
              <span className="dg-text">{m.text}</span>
              {m.at && <span className="dg-when">{ago(m.at)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
