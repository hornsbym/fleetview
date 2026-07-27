// Pure presentational project switcher. Supersedes the inline switcher in App.tsx.
// State (selection, fleet fetch) lives in the parent; this only renders + reports clicks.
import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import type { Project } from '../../../lib/claude-adapter/types';
import { projectAttention, sortByAttention, type ProjectAttention } from '../shared/attention';
import './ProjectSwitcher.css';

export interface ProjectSwitcherProps {
  projects: Project[];
  selected: string | null;
  onSelect: (path: string) => void;
  completed?: Set<string>;
}

interface Signal {
  key: 'awaiting' | 'blocked' | 'stalled';
  label: string;
}

function signals(a: ProjectAttention): Signal[] {
  const out: Signal[] = [];
  if (a.awaitingApproval > 0) out.push({ key: 'awaiting', label: `${a.awaitingApproval} awaiting approval` });
  if (a.blocked > 0) out.push({ key: 'blocked', label: `${a.blocked} blocked` });
  if (a.stalled > 0) out.push({ key: 'stalled', label: `${a.stalled} stalled` });
  return out;
}

/** Re-map the freshly sorted list onto a held order, matched by path so a project
 *  disappearing mid-hold shifts nothing; anything new lands after the held ones. */
function applyHeldOrder(sorted: Project[], held: string[]): Project[] {
  const rank = new Map<string, number>(held.map((path, i) => [path, i] as const));
  return sorted
    .map((project, index) => ({ project, index, rank: rank.get(project.path) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.project);
}

export function ProjectSwitcher({ projects, selected, onSelect, completed }: ProjectSwitcherProps) {
  // The fleet re-polls every 2.5s, and a re-sort can slide a card out from under an
  // in-flight click. So the ORDER freezes while a pointer or focus is in the list —
  // the only window where moving hurts; card contents keep updating throughout.
  const [held, setHeld] = useState<string[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pointerIn = useRef(false);

  const sorted = useMemo(() => sortByAttention(projects), [projects]);
  const ordered = useMemo(() => (held ? applyHeldOrder(sorted, held) : sorted), [sorted, held]);

  // Release only when neither pointer nor focus is in the list — a hovering mouse
  // leaving must not re-sort under a keyboard user's focused card, or vice versa.
  const releaseIfIdle = () => {
    const el = rootRef.current;
    if (!pointerIn.current && !(el && el.contains(document.activeElement))) setHeld(null);
  };

  useEffect(() => {
    if (!held) return;
    // If the list shrinks out from under the pointer, the container may never get a
    // pointerleave — so the first move outside it clears the stale hover.
    const onMove = (e: PointerEvent) => {
      const el = rootRef.current;
      if (!el || el.contains(e.target as Node)) return;
      pointerIn.current = false;
      if (!el.contains(document.activeElement)) setHeld(null);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [held]);

  if (projects.length === 0) {
    return <div className="ps-empty">No projects yet — add a watched repo below.</div>;
  }

  const hold = () => setHeld((h) => h ?? ordered.map((p) => p.path));
  const onPointerEnter = () => { pointerIn.current = true; hold(); };
  const onPointerLeave = () => { pointerIn.current = false; releaseIfIdle(); };
  // Tabbing between two cards must not release the hold and re-sort under the user.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) releaseIfIdle();
  };

  return (
    <div
      className="project-switcher"
      ref={rootRef}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={hold}
      onBlur={onBlur}
    >
      {ordered.map((p) => {
        const isSel = p.path === selected;
        const sessions = p.sessions.length;
        const attn = projectAttention(p);
        const rows = signals(attn);
        const hasDone = completed ? p.sessions.some((s) => completed.has(s.id)) : false;
        const flag = attn.needsAttention
          ? ' flagged' + (attn.awaitingApproval > 0 ? '' : ' flag-blocked')
          : hasDone ? ' completed' : '';
        return (
          <button
            key={p.path}
            type="button"
            className={'ps-card' + (isSel ? ' sel' : '') + flag}
            aria-pressed={isSel}
            onClick={() => onSelect(p.path)}
          >
            <div className="ps-name">
              <span className="ps-name-t">{p.name}</span>
              {p.live
                ? <span className="live"><span className="dot" />live</span>
                : <span className="idle">◦ idle</span>}
            </div>
            {rows.length > 0 && (
              // Badge text IS the accessible name (no aria-label, which would drift
              // from it); the lead-in tells a screen reader what the hue tells an eye.
              <div className="ps-signals">
                <span className="ps-sr">{attn.needsAttention ? 'Needs attention:' : 'Status:'}</span>
                {rows.map((s) => (
                  <span key={s.key} className={`ps-badge ${s.key}`}>{s.label}</span>
                ))}
              </div>
            )}
            <div className="ps-path mono" title={p.path}>{p.path}</div>
            <div className="ps-meta">
              {sessions} session{sessions !== 1 ? 's' : ''}
              {p.live && ` · ${p.activeTeammates} active teammate${p.activeTeammates !== 1 ? 's' : ''}`}
            </div>
          </button>
        );
      })}
    </div>
  );
}
