import { useEffect, useState } from 'react';
// Type-only import: erased at build, so no Node code leaks into the browser bundle.
import type { Fleet, Session, Teammate } from '../lib/claude-adapter/types';
import { ProjectSwitcher, AddProject } from '../features/projects/web';
import { Teammates } from '../features/teammates/web';
import { TaskBoard } from '../features/task-board/web';
import { OrchestratorChat } from '../features/orchestrator-chat/web';

// Approve/request-changes routes THROUGH the repo's orchestrator (which owns
// SendMessage) — FleetView never resumes agents directly. Non-blocking: one message,
// no polling.
function postOrchestratorMessage(repo: string, text: string) {
  fetch('/api/orchestrator/message', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repo, text }),
  }).catch(() => { /* UI decides; surfacing errors is a later polish */ });
}

export function App() {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [orchRunning, setOrchRunning] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const d: Fleet = await (await fetch('/api/fleet')).json();
        if (!alive) return;
        setFleet(d); setErr(null);
        setSelected((s) => (s && d.projects.some((p) => p.path === s)) ? s : (d.projects[0]?.path ?? null));
      } catch (e: any) { if (alive) setErr(String(e?.message || e)); }
    };
    poll();
    const id = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [refreshKey]);

  // Does FleetView own a RUNNING orchestrator for the selected repo? Approval
  // buttons only enable when true — otherwise clicking would misfire.
  useEffect(() => {
    if (!selected) { setOrchRunning(false); return; }
    let alive = true;
    const check = async () => {
      try {
        const r = await (await fetch(`/api/orchestrator/status?repo=${encodeURIComponent(selected)}`)).json();
        if (alive) setOrchRunning(r?.status === 'running');
      } catch { if (alive) setOrchRunning(false); }
    };
    check();
    const id = setInterval(check, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [selected]);

  if (!fleet) return <div className="empty">{err ? `Error: ${err}` : 'Loading fleet…'}</div>;
  const project = fleet.projects.find((p) => p.path === selected) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <strong>▚ FLEETVIEW</strong>
        <span className="tag">monitor plane</span>
        <span className="spacer" />
        <span className="stamp mono">updated {new Date(fleet.generatedAt).toLocaleTimeString()}</span>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <div className="label">Projects</div>
          <ProjectSwitcher projects={fleet.projects} selected={selected} onSelect={setSelected} />
          <AddProject onConfigChange={() => setRefreshKey((k) => k + 1)} />
        </aside>
        <main className="main">
          {!project ? (
            <div className="empty">Select a project.</div>
          ) : (
            <>
              <div className="chat-panel"><OrchestratorChat repo={project.path} /></div>
              {project.sessions.length === 0
                ? <div className="empty">No monitor-plane sessions discovered yet.</div>
                : project.sessions.map((s) => (
                    <SessionCard
                      key={s.id}
                      s={s}
                      approvable={orchRunning}
                      onApprove={(m) => postOrchestratorMessage(project.path, `Approved: use SendMessage to tell the teammate with agentId ${m.agentId} (${m.agentType}) exactly "approved, proceed with your plan." Then keep coordinating — do not poll it.`)}
                      onRequestChanges={(m) => postOrchestratorMessage(project.path, `Request changes: SendMessage the teammate with agentId ${m.agentId} (${m.agentType}) to revise its plan; keep it awaiting approval.`)}
                    />
                  ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function SessionCard({ s, onApprove, onRequestChanges, approvable }: {
  s: Session;
  onApprove?: (m: Teammate) => void;
  onRequestChanges?: (m: Teammate) => void;
  approvable?: boolean;
}) {
  return (
    <section className="card">
      <div className="card-head">
        {s.live ? <span className="live"><span className="dot" />live</span> : <span className="idle">◦ inactive</span>}
        <span className="mono id">{s.id}</span>
        <span className="counts">
          <span className="chip">{s.counts.pending} upcoming</span>
          <span className="chip a">{s.counts.in_progress} active</span>
          <span className="chip d">{s.counts.completed} done</span>
        </span>
      </div>
      <div className="card-body">
        <div className="col">
          <h3>Team — what each agent is doing</h3>
          <Teammates members={s.members} onApprove={onApprove} onRequestChanges={onRequestChanges} approvable={approvable} />
        </div>
        <div className="col">
          <h3>Task board</h3>
          <TaskBoard tasks={s.tasks} />
        </div>
      </div>
    </section>
  );
}
