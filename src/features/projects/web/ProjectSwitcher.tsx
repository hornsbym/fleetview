// Pure presentational project switcher. Supersedes the inline switcher in App.tsx.
// State (selection, fleet fetch) lives in the parent; this only renders + reports clicks.
import type { Project } from '../../../lib/claude-adapter/types';
import './ProjectSwitcher.css';

export interface ProjectSwitcherProps {
  projects: Project[];
  selected: string | null;
  onSelect: (path: string) => void;
}

export function ProjectSwitcher({ projects, selected, onSelect }: ProjectSwitcherProps) {
  if (projects.length === 0) {
    return <div className="ps-empty">No projects yet — add a watched repo below.</div>;
  }
  return (
    <div className="project-switcher">
      {projects.map((p) => {
        const isSel = p.path === selected;
        const sessions = p.sessions.length;
        return (
          <button
            key={p.path}
            type="button"
            className={'ps-card' + (isSel ? ' sel' : '')}
            aria-pressed={isSel}
            onClick={() => onSelect(p.path)}
          >
            <div className="ps-name">
              <span className="ps-name-t">{p.name}</span>
              {p.live
                ? <span className="live"><span className="dot" />live</span>
                : <span className="idle">◦ idle</span>}
            </div>
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
