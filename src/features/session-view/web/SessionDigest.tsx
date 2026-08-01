// The orientation panels for a session: enough to re-enter a session's context
// after being away, without reading the transcript.
//
//   • NowPanel     — 1-3 sentences on the conceptual work in flight.
//   • SummaryPanel — agent-authored bullets on what the session has accomplished.
//
// Both read from `.fleetview/sessions/<id>.json`, with NowPanel falling back to
// transcript-derived activity when no report file exists.
import type { SessionDigest, SummaryAnchor } from '../shared/events';
import './SessionDigest.css';


export function NowPanel({ digest, live, status, waitingFor }: {
  digest: SessionDigest | null;
  live: boolean;
  /** From `claude agents --json`: 'busy' | 'idle' | 'waiting' | 'shell'. */
  status?: string | null;
  waitingFor?: string | null;
}) {
  const working = live && status !== 'idle' && status !== 'waiting';
  const blocked = live && status === 'waiting';
  const done = !working && !blocked;

  if (done && !digest?.now && !digest?.goal && !digest?.lastRequest) return null;

  const heading = blocked ? 'Waiting' : done ? 'Just completed' : 'Working on now';

  return (
    <section className={`dg dg-now${done ? ' dg-done-state' : ''}`} aria-label={heading}>
      <div className="dg-head">
        <h3>{heading}</h3>
        {working && <span className="dg-pulse" aria-hidden="true" />}
        {working && digest?.reported && (
          <span className="dg-src" title="Reported by the agent itself">self-reported</span>
        )}
      </div>

      {blocked
        ? <p className="dg-prose dg-blocked">Waiting on you{waitingFor ? ` — ${waitingFor}` : ''}.</p>
        : digest?.now
          ? <p className="dg-prose">{digest.now}</p>
          : <p className="dg-none">Nothing reported yet.</p>}

      {(digest?.goal || digest?.lastRequest) && (
        <div className="dg-goal">
          <span className="dg-goal-label">{done ? 'Worked toward' : 'Working toward'}</span>
          <span className="dg-goal-text" title={digest.goal || digest.lastRequest || ''}>{digest.goal || digest.lastRequest}</span>
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

export function SummaryPanel({ digest, onJump }: {
  digest: SessionDigest | null;
  /** Scroll the transcript to where this bullet's work happened. Omitted where
   *  there's no transcript alongside the panel to scroll. */
  onJump?: (anchor: SummaryAnchor) => void;
}) {
  const bullets = digest?.summary ?? [];
  if (!bullets.length) return null;

  return (
    <section className="dg dg-summary" aria-label="Session summary">
      <div className="dg-head">
        <h3>Summary</h3>
      </div>
      <ul className="dg-bullets">
        {bullets.map((b, i) => {
          const anchor = onJump && b.anchor ? b.anchor : null;
          return (
            <li key={i} className="dg-bullet">
              {/* Only bullets we can actually trace become interactive. An
                  untraceable one stays plain text rather than offering a jump
                  that goes nowhere. */}
              {anchor
                ? (
                  <button
                    type="button"
                    className="dg-bullet-title dg-bullet-jump"
                    onClick={() => onJump!(anchor)}
                    title="Jump to this in the transcript"
                  >
                    {b.title}
                  </button>
                )
                : <span className="dg-bullet-title">{b.title}</span>}
              {b.description && <span className="dg-bullet-desc">{b.description}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
