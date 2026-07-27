import { useCallback, useMemo, useState } from 'react';
// Type-only import: erased at build, so no Node code leaks into the browser bundle.
import type { Fleet, Project, Session, SessionDigest } from '../lib/claude-adapter/types';
import { ProjectSwitcher, AddProject } from '../features/projects/web';
import { projectSlugs } from '../features/projects/shared/slug';
import { Teammates } from '../features/teammates/web';
import { TaskBoard } from '../features/task-board/web';
import { SessionView, NowPanel, DonePanel } from '../features/session-view/web';
import { HookSetup } from '../features/hooks/web';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { usePath, parseRoute, navigate, projectPath, sessionPath } from './router';

export function App() {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const path = usePath();
  const route = parseRoute(path);

  // Stable identity: an inline arrow here is what fed the AddProject render loop.
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const pollFleet = useCallback(() => {
    void (async () => {
      try {
        const d: Fleet = await (await fetch('/api/fleet')).json();
        setFleet(d); setErr(null);
      } catch (e: any) { setErr(String(e?.message || e)); }
    })();
  }, []);
  useVisiblePoll(pollFleet, 2500, refreshKey);

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
        <span className="tag">monitor</span>
        <span className="spacer" />
        <span className="stamp mono">updated {new Date(fleet.generatedAt).toLocaleTimeString()}</span>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <div className="label">Projects</div>
          <ProjectSwitcher projects={fleet.projects} selected={selectedRepo} onSelect={(p) => navigate(projectPath(toSlug.get(p) ?? ''))} />
          <AddProject onConfigChange={bumpRefresh} />
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
  return (
    <>
      <HookSetup />
      <div className="pv-head">
        <div>
          <h2 className="pv-title">{project.name}</h2>
          <div className="pv-path mono">{project.path}</div>
        </div>
      </div>

      {project.sessions.length === 0 ? (
        <div className="empty">
          No sessions yet. Run <code>claude</code> in this folder and it will appear here.
        </div>
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
        {/* Don't invent a status. Some sessions (notably SDK-spawned ones) never
            report one — claiming "active" there is worse than saying "live". */}
        {s.live ? <span className="live"><span className="dot" />{s.status || 'live'}</span> : <span className="idle">◦ inactive</span>}
        {s.kind === 'background' && <span className="tile-own">bg</span>}
        {s.needsApproval && (
          <span className="tile-approve">
            {s.pendingApprovals > 1 ? `${s.pendingApprovals} need approval` : 'needs approval'}
          </span>
        )}
        <span className="mono tile-id" title={s.id}>{s.name || s.id}</span>
      </div>
      <div className="tile-meta">
        {teammates} teammate{teammates !== 1 ? 's' : ''}
        {s.waitingFor && <span className="chip">waiting · {s.waitingFor}</span>}
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
  // The digest is fetched once by SessionView (which renders "Working on now"
  // above the transcript) and lifted here so "Done so far" can sit in the side
  // column without a second request.
  const [digest, setDigest] = useState<SessionDigest | null>(null);
  return (
    <div className="sp">
      <div className="sp-crumbs">
        <button type="button" className="link" onClick={() => navigate(projectPath(slug))}>← {repo.split('/').pop()}</button>
        <span className="sp-crumb-sep">/</span>
        <span className="mono sp-crumb-id" title={sessionId}>{session?.name || sessionId}</span>
      </div>
      <div className="sp-grid">
        <div className="sp-chat">
          <SessionView session={session} repo={repo} sessionId={sessionId} onDigest={setDigest} />
        </div>
        <div className="sp-agents">
          <section className="card">
            <div className="col">
              <h3>Team — what each agent is doing</h3>
              {session && session.members.length > 0
                ? <Teammates members={session.members} live={!!session.live} approvable={false} />
                : <div className="none">No teammates in this session.</div>}
            </div>
          </section>
          <NowPanel
            digest={digest}
            live={!!session?.live}
            status={session?.status}
            waitingFor={session?.waitingFor}
          />
          <DonePanel digest={digest} />
          <section className="card">
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
