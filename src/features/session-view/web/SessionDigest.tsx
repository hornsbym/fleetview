// Two panels for the session page:
//   • NowPanel  — what this agent is doing right now, with the trail that led here.
//   • DonePanel — the high-level things it has actually finished this session.
//
// Both come from one server-side digest of the session transcript. Because the
// transcript keeps everything across context compactions, the "done" list does
// too — it is not reconstructed from the model's (shrinking) context.
import type { Milestone, SessionDigest, TrailItem } from '../shared/events';
import './SessionDigest.css';

/** "12s ago" / "4m ago" — same shape the teammates panel uses. */
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
  commit: 'commit',
  task: 'task',
  plan: 'plan',
  compaction: 'compact',
};

export function NowPanel({ digest, live }: { digest: SessionDigest | null; live: boolean }) {
  const doing = digest?.doing ?? null;

  return (
    <section className="dg dg-now" aria-label="What this agent is doing now">
      <div className="dg-head">
        <h3>Working on now</h3>
        {live && <span className="dg-pulse" aria-hidden="true" />}
      </div>

      {digest?.lastRequest && (
        <div className="dg-goal" title={digest.lastRequest}>
          <span className="dg-goal-label">Toward</span>
          {digest.lastRequest}
        </div>
      )}

      {doing ? (
        <>
          <div className="dg-doing">
            <span className="dg-tool mono">{doing.name}</span>
            <span className="dg-summary">{doing.summary}</span>
            <span className="dg-when">{ago(doing.at)}</span>
          </div>
          {digest && digest.trail.length > 1 && (
            <ol className="dg-trail">
              {digest.trail.slice(1).map((t: TrailItem, i: number) => (
                <li key={i}>
                  <span className="dg-tool mono">{t.name}</span>
                  <span className="dg-summary">{t.summary}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <p className="dg-none">{live ? 'No tool activity yet.' : 'This session is not running.'}</p>
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
  const done = digest?.done ?? [];
  return (
    <section className="dg dg-done" aria-label="What this session has completed">
      <div className="dg-head">
        <h3>Done so far</h3>
        {done.length > 0 && <span className="dg-count mono">{done.length}</span>}
      </div>

      {done.length === 0 ? (
        <p className="dg-none">
          Nothing completed yet. Commits, finished tasks and approved plans show up here.
        </p>
      ) : (
        <ul className="dg-list">
          {done.map((m, i) => (
            <li key={i} className={`dg-item dg-${m.kind}`}>
              <span className="dg-kind">{KIND_LABEL[m.kind] ?? m.kind}</span>
              <span className="dg-text" title={m.text}>{m.text}</span>
              <span className="dg-when">{ago(m.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
