// The orientation panels for a session: enough to re-enter a session's context
// after being away, without reading the transcript.
//
//   • NowPanel  — 1-3 sentences on the conceptual work in flight. Never a command.
//   • DonePanel — the numbered running list of what this session has accomplished.
//
// Both prefer the agent's own account (`.fleetview/sessions/<id>.json`) and fall
// back to what can be derived from the transcript.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Milestone, SessionDigest } from '../shared/events';
import './SessionDigest.css';

/** How many of the most recent entries stay visible while collapsed. */
const COLLAPSED_COUNT = 5;

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
  reported: '',
  commit: 'commit',
  task: 'task',
  plan: 'plan',
  compaction: 'compact',
};

export function NowPanel({ digest, live, status, waitingFor }: {
  digest: SessionDigest | null;
  live: boolean;
  /** From `claude agents --json`: 'busy' | 'idle' | 'waiting' | 'shell'. */
  status?: string | null;
  waitingFor?: string | null;
}) {
  // An idle session is not working, whatever it last wrote about itself. A
  // self-reported sentence goes stale the moment the agent stops, and showing
  // "Tracking down a bug…" for a session that finished ten minutes ago is worse
  // than saying nothing — so liveness overrides the report here.
  const working = live && status !== 'idle' && status !== 'waiting';
  const blocked = live && status === 'waiting';

  return (
    <section className="dg dg-now" aria-label="What this agent is working on now">
      <div className="dg-head">
        <h3>Working on now</h3>
        {working && <span className="dg-pulse" aria-hidden="true" />}
        {working && digest?.reported && (
          <span className="dg-src" title="Reported by the agent itself">self-reported</span>
        )}
      </div>

      {blocked
        ? <p className="dg-prose dg-blocked">Waiting on you{waitingFor ? ` — ${waitingFor}` : ''}.</p>
        : !working
          ? <p className="dg-idle">Not currently working on anything.</p>
          : digest?.now
            ? <p className="dg-prose">{digest.now}</p>
            : <p className="dg-none">Nothing reported yet.</p>}

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

export function DonePanel({ digest, sessionId }: { digest: SessionDigest | null; sessionId?: string }) {
  // The two sources arrive in opposite orders — a self-reported list is the
  // agent's own chronological narrative, derived milestones come newest-first.
  // Normalize to chronological so numbering ascends with time: a higher number is
  // always a more recent item, and the newest sits at the bottom.
  const items = useMemo(() => {
    const list = digest?.done ?? [];
    return digest?.reported ? list : [...list].reverse();
  }, [digest]);

  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

  // Reset only when the session changes, so the 2.5s poll can't collapse what the
  // user just opened (the same identity-latch discipline the task board uses).
  const latched = useRef(sessionId);
  useEffect(() => {
    if (latched.current === sessionId) return;
    latched.current = sessionId;
    setExpanded(false);
  }, [sessionId]);

  const hidden = Math.max(0, items.length - COLLAPSED_COUNT);
  const shown = expanded ? items : items.slice(-COLLAPSED_COUNT);
  // Numbering is against the FULL list, so a collapsed view still tells you where
  // you are — "8, 9, 10, 11, 12" rather than restarting at 1.
  const firstNumber = expanded ? 1 : items.length - shown.length + 1;

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
        <>
          <ol className="dg-list" id={bodyId} start={firstNumber}>
            {shown.map((m, i) => (
              <li key={firstNumber + i} className={`dg-item dg-${m.kind}`}>
                <span className="dg-text">
                  {m.text}
                  {KIND_LABEL[m.kind] && <span className="dg-kind">{KIND_LABEL[m.kind]}</span>}
                </span>
                {m.at && <span className="dg-when">{ago(m.at)}</span>}
              </li>
            ))}
          </ol>

          {hidden > 0 && (
            <button
              type="button"
              className="dg-toggle"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => setExpanded(e => !e)}
            >
              <span className="dg-chevron" aria-hidden="true" />
              {expanded ? 'Show recent only' : `Show all ${items.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
