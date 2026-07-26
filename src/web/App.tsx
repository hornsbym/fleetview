import { useCallback, useEffect, useMemo, useState } from 'react';
// Type-only import: erased at build, so no Node code leaks into the browser bundle.
import type { Fleet, Project, Session, Teammate } from '../lib/claude-adapter/types';
import { ProjectSwitcher, AddProject } from '../features/projects/web';
import { projectSlugs } from '../features/projects/shared/slug';
import { Teammates } from '../features/teammates/web';
import { TaskBoard } from '../features/task-board/web';
import { OrchestratorChat } from '../features/orchestrator-chat/web';
import { usePath, parseRoute, navigate, projectPath, sessionPath, LIVE } from './router';

// Approve/request-changes routes THROUGH the repo's orchestrator (which owns
// SendMessage) — FleetView never resumes agents directly. Non-blocking: one message.
function postOrchestratorMessage(repo: string, text: string) {
  fetch('/api/orchestrator/message', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repo, text }),
  }).catch(() => { /* UI decides; surfacing errors is a later polish */ });
}

export function App() {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const path = usePath();
  const route = parseRoute(path);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const d: Fleet = await (await fetch('/api/fleet')).json();
        if (alive) { setFleet(d); setErr(null); }
      } catch (e: any) { if (alive) setErr(String(e?.message || e)); }
    };
    poll();
    const id = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [refreshKey]);

  // Hooks must run before any early return; derive slug maps from the current fleet.
  const slugMaps = useMemo(() => projectSlugs((fleet?.projects ?? []).map((p) => p.path)), [fleet]);

  if (!fleet) return <div className="empty">{err ? `Error: ${err}` : 'Loading fleet…'}</div>;

  // Clean slugs (repo folder name) ↔ absolute paths, resolved against the live fleet.
  const { toSlug, toPath } = slugMaps;
  const selectedRepo = (route.slug && toPath.get(route.slug)) ?? fleet.projects[0]?.path ?? null;
  const project = fleet.projects.find((p) => p.path === selectedRepo) ?? null;
  const slug = selectedRepo ? toSlug.get(selectedRepo) ?? '' : '';
  const session = project && route.sessionId
    ? project.sessions.find((s) => s.id === route.sessionId) ?? null
    : null;

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => navigate('/')}>▚ FLEETVIEW</button>
        <span className="tag">monitor + control</span>
        <span className="spacer" />
        <span className="stamp mono">updated {new Date(fleet.generatedAt).toLocaleTimeString()}</span>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <div className="label">Projects</div>
          <ProjectSwitcher projects={fleet.projects} selected={selectedRepo} onSelect={(p) => navigate(projectPath(toSlug.get(p) ?? ''))} />
          <AddProject onConfigChange={() => setRefreshKey((k) => k + 1)} />
        </aside>
        <main className="main">
          {!project ? (
            <div className="empty">Select a project.</div>
          ) : route.sessionId ? (
            <SessionPage repo={project.path} slug={slug} sessionId={route.sessionId} session={session} />
          ) : (
            <ProjectView project={project} slug={slug} />
          )}
        </main>
      </div>
    </div>
  );
}

function ProjectView({ project, slug }: { project: Project; slug: string }) {
  const [warn, setWarn] = useState(false);

  // Navigate to the live page immediately, then fire the start — the session page
  // polls status and flips to live on its own, so nothing hinges on this response.
  const start = useCallback(() => {
    setWarn(false);
    navigate(sessionPath(slug, LIVE));
    fetch('/api/orchestrator/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo: project.path }) }).catch(() => { /* session page shows start state */ });
  }, [project.path, slug]);

  const onNew = () => { if (project.live) setWarn(true); else start(); };

  return (
    <>
      <div className="pv-head">
        <div>
          <h2 className="pv-title">{project.name}</h2>
          <div className="pv-path mono">{project.path}</div>
        </div>
        <button type="button" className="btn primary" onClick={onNew}>＋ New session</button>
      </div>

      {warn && (
        <div className="warn">
          <span>⚠ This project already has an active session. Running two orchestrators on the same repo at once can cause code conflicts.</span>
          <div className="warn-actions">
            <button type="button" className="btn" onClick={() => setWarn(false)}>Cancel</button>
            <button type="button" className="btn danger" onClick={() => start()}>Start anyway</button>
          </div>
        </div>
      )}

      {project.sessions.length === 0 ? (
        <div className="empty">No sessions yet — start one to begin driving this project's orchestrator.</div>
      ) : (
        <div className="tiles">
          {project.sessions.map((s) => <SessionTile key={s.id} slug={slug} s={s} />)}
        </div>
      )}
    </>
  );
}

function SessionTile({ slug, s }: { slug: string; s: Session }) {
  const teammates = s.members.filter((m) => !m.isLead).length;
  return (
    <button type="button" className={'tile' + (s.needsApproval ? ' flagged' : '')} onClick={() => navigate(sessionPath(slug, s.id))}>
      <div className="tile-head">
        {s.live ? <span className="live"><span className="dot" />active</span> : <span className="idle">◦ inactive</span>}
        {s.owned && <span className="tile-own">FleetView</span>}
        {s.needsApproval && <span className="tile-approve">needs approval</span>}
        <span className="mono tile-id">{s.id}</span>
      </div>
      <div className="tile-meta">
        {teammates} teammate{teammates !== 1 ? 's' : ''}
        <span className="tile-counts">
          <span className="chip">{s.counts.pending} upcoming</span>
          <span className="chip a">{s.counts.in_progress} active</span>
          <span className="chip d">{s.counts.completed} done</span>
        </span>
      </div>
    </button>
  );
}

function SessionPage({ repo, slug, sessionId, session }: { repo: string; slug: string; sessionId: string; session: Session | null }) {
  const approvable = !!(session?.owned && session?.live);
  return (
    <div className="sp">
      <div className="sp-crumbs">
        <button type="button" className="link" onClick={() => navigate(projectPath(slug))}>← {repo.split('/').pop()}</button>
        <span className="sp-crumb-sep">/</span>
        <span className="mono sp-crumb-id">{sessionId === LIVE ? 'live session' : sessionId}</span>
      </div>
      <div className="sp-grid">
        <div className="sp-chat"><OrchestratorChat repo={repo} sessionId={sessionId} /></div>
        <div className="sp-agents">
          <section className="card">
            <div className="col">
              <h3>Team — what each agent is doing</h3>
              {session && session.members.length > 0 ? (
                <Teammates
                  members={session.members}
                  approvable={approvable}
                  onApprove={(m: Teammate) => postOrchestratorMessage(repo, `Approved: use SendMessage to tell the teammate with agentId ${m.agentId} (${m.agentType}) exactly "approved, proceed with your plan." Then keep coordinating — do not poll it.`)}
                  onRequestChanges={(m: Teammate) => postOrchestratorMessage(repo, `Request changes: SendMessage the teammate with agentId ${m.agentId} (${m.agentType}) to revise its plan; keep it awaiting approval.`)}
                />
              ) : <div className="none">No teammates in this session.</div>}
            </div>
            <div className="col">
              <h3>Task board</h3>
              {session ? <TaskBoard tasks={session.tasks} /> : <div className="none">No task board for this session.</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
