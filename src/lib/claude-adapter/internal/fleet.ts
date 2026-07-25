// Monitor-plane assembly: read teams + tasks + subagents + worktrees + transcripts
// and normalize into FleetView's own Fleet shape. All Claude Code coupling lives here.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HOME, TASKS, TEAMS, PROJECTS, encodeCwd } from './paths';
import { readActivity, transcriptCwd } from './transcripts';
import type { Fleet, Project, Session, Task, Teammate, FleetConfig, AgentPlanFile } from '../types';

const pexec = promisify(execFile);

async function readJson(p: string): Promise<any | null> {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}
async function listDirs(p: string): Promise<string[]> {
  try { return (await readdir(p, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); }
  catch { return []; }
}

async function loadTasks(dir: string): Promise<Task[]> {
  let files: string[]; try { files = await readdir(dir); } catch { return []; }
  const tasks: Task[] = [];
  for (const f of files) if (/^\d+\.json$/.test(f)) { const t = await readJson(path.join(dir, f)); if (t) tasks.push(t); }
  return tasks.sort((a, b) => Number(a.id) - Number(b.id));
}

async function loadLiveTeams(): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (const n of await listDirs(TEAMS)) { const c = await readJson(path.join(TEAMS, n, 'config.json')); if (c) out[n] = c; }
  return out;
}

async function findTranscript(id: string): Promise<string | null> {
  if (!id) return null;
  const prefix = id.startsWith('session-') ? id.slice(8) : id;
  for (const pd of await listDirs(PROJECTS)) {
    let files: string[]; try { files = await readdir(path.join(PROJECTS, pd)); } catch { continue; }
    const hit = files.find(f => f.endsWith('.jsonl') && (f === id + '.jsonl' || f.startsWith(prefix)));
    if (hit) return path.join(PROJECTS, pd, hit);
  }
  return null;
}

async function worktreeAgents(repoCwd: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const { stdout } = await pexec('git', ['-C', repoCwd, 'worktree', 'list', '--porcelain'], { maxBuffer: 1 << 20 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/^worktree (.*\/\.claude\/worktrees\/agent-([0-9a-f]+))\s*$/);
      if (m) map[m[2]] = m[1];
    }
  } catch { /* not a git repo / no worktrees */ }
  return map;
}

function newTeammate(partial: Partial<Teammate> & Pick<Teammate, 'agentId' | 'name' | 'agentType' | 'isLead'>): Teammate {
  return {
    cwd: null, worktree: null, task: null, action: null, actionAt: null,
    plan: null, hasTranscript: false, stale: false, ...partial,
  };
}

// M6: an agent self-reports its plan + progress to <worktree>/.fleetview/plan.json.
// This keeps progress tracking off the orchestrator's critical path.
async function readAgentPlan(worktreeCwd: string): Promise<AgentPlanFile | null> {
  return readJson(path.join(worktreeCwd, '.fleetview', 'plan.json'));
}
function applyPlanFile(t: Teammate, pf: AgentPlanFile | null) {
  if (!pf) return;
  if (pf.phase) t.phase = pf.phase;
  if (Array.isArray(pf.steps) && pf.steps.length) {
    t.plan = pf.steps.map(s => ({ content: s.subject, status: s.status || 'pending' }));
    const ip = pf.steps.find(s => s.status === 'in_progress');
    t.task = { subject: ip?.subject || pf.task || t.task?.subject || '' };
  } else if (pf.task) {
    t.task = { subject: pf.task };
  }
}

// Feature/worktree agents are spawned via Agent tool + isolation:worktree; they do
// NOT register in the team roster. Discover them from the subagents/ dir + meta.json.
async function discoverSubagents(repoCwd: string, leadSessionId: string): Promise<Teammate[]> {
  const dir = path.join(PROJECTS, encodeCwd(repoCwd), leadSessionId, 'subagents');
  let files: string[]; try { files = (await readdir(dir)).filter(f => /^agent-.*\.jsonl$/.test(f)); } catch { return []; }
  const wt = await worktreeAgents(repoCwd);
  const out: Teammate[] = [];
  for (const f of files) {
    const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const full = path.join(dir, f);
    let mtime = 0; try { mtime = (await stat(full)).mtimeMs; } catch { continue; }
    const meta = (await readJson(path.join(dir, `agent-${id}.meta.json`))) || {};
    const a = await readActivity(full);
    const t = newTeammate({
      agentId: id,
      name: meta.agentType || `agent-${id.slice(0, 8)}`,
      agentType: meta.agentType || `agent-${id.slice(0, 8)}`,
      desc: meta.description || '',
      isLead: false,
      cwd: wt[id] || null,
      worktree: wt[id] || null,
      action: a.action, actionAt: a.at, plan: a.plan,
      hasTranscript: true,
      stale: Date.now() - mtime > 45000,
    });
    if (t.cwd) applyPlanFile(t, await readAgentPlan(t.cwd));
    out.push(t);
  }
  // Worktree agents + anything currently active; drop finished ephemeral helpers.
  return out
    .filter(s => s.cwd || !s.stale)
    .sort((x, y) => Number(x.stale) - Number(y.stale) || x.agentType.localeCompare(y.agentType));
}

export async function buildFleet(config: FleetConfig = {}): Promise<Fleet> {
  const teams = await loadLiveTeams();
  const sessions: any[] = [];

  for (const dir of await listDirs(TASKS)) {
    const tasks = await loadTasks(path.join(TASKS, dir));
    const team = teams[dir] || null;
    if (!tasks.length && !team) continue;
    let cwd: string | null = null;
    if (team) { const lead = (team.members || []).find((m: any) => m.agentId === team.leadAgentId) || team.members?.[0]; cwd = lead?.cwd || null; }
    if (!cwd) cwd = await transcriptCwd(await findTranscript(dir));
    sessions.push({ id: dir, live: !!team, team, tasks, cwd, leadSessionId: team?.leadSessionId || null });
  }
  for (const [name, team] of Object.entries<any>(teams)) {
    if (sessions.some(s => s.id === name)) continue;
    const lead = (team.members || []).find((m: any) => m.agentId === team.leadAgentId) || team.members?.[0];
    sessions.push({ id: name, live: true, team, tasks: [], cwd: lead?.cwd || null, leadSessionId: team.leadSessionId || null });
  }

  for (const s of sessions) {
    let members: Teammate[];
    if (s.team) {
      members = (s.team.members || []).map((m: any) => newTeammate({
        agentId: m.agentId, name: m.name, agentType: m.agentType,
        isLead: m.agentId === s.team.leadAgentId, cwd: m.cwd || null,
      }));
      for (const t of s.tasks as Task[]) {
        if (t.owner && !members.some(m => m.name === t.owner || m.agentType === t.owner))
          members.push(newTeammate({ agentId: t.owner, name: t.owner, agentType: t.owner, isLead: t.owner === 'orchestrator' }));
      }
    } else {
      members = [...new Set((s.tasks as Task[]).map(t => t.owner).filter(Boolean))]
        .map((o: any) => newTeammate({ agentId: o, name: o, agentType: o, isLead: o === 'orchestrator' }));
    }

    const ownedBy = (m: Teammate) => (s.tasks as Task[]).filter(t => t.owner === m.name || t.owner === m.agentType);
    for (const m of members) {
      const ip = (s.tasks as Task[]).find(t => t.status === 'in_progress' && (t.owner === m.name || t.owner === m.agentType));
      m.task = ip ? { subject: ip.subject, activeForm: ip.activeForm } : null;
      const owned = ownedBy(m);
      if (owned.length) m.plan = owned.map(t => ({ content: t.subject, status: t.status }));
      if (m.isLead && s.leadSessionId) {
        const tp = await findTranscript(s.leadSessionId);
        if (tp) { const a = await readActivity(tp); m.action = a.action; m.actionAt = a.at; m.hasTranscript = true; if (a.plan) m.plan = a.plan; }
      }
    }

    if (s.live && s.leadSessionId && s.cwd) {
      for (const sub of await discoverSubagents(s.cwd, s.leadSessionId)) {
        // A self-reported plan file (sub.phase set) is authoritative; otherwise
        // fall back to the harness task list grouped by owner.
        if (!sub.phase) {
          const owned = (s.tasks as Task[]).filter(t => t.owner === sub.agentType || t.owner === sub.name);
          if (owned.length && !sub.plan) sub.plan = owned.map(t => ({ content: t.subject, status: t.status }));
          const ip = (s.tasks as Task[]).find(t => t.status === 'in_progress' && (t.owner === sub.agentType || t.owner === sub.name));
          if (ip) sub.task = { subject: ip.subject, activeForm: ip.activeForm };
        }
        members.push(sub);
      }
    }

    s.members = members;
    s.counts = {
      pending: (s.tasks as Task[]).filter(t => t.status === 'pending').length,
      in_progress: (s.tasks as Task[]).filter(t => t.status === 'in_progress').length,
      completed: (s.tasks as Task[]).filter(t => t.status === 'completed').length,
    };
    delete s.team;
  }

  const byProject: Record<string, Project> = {};
  for (const s of sessions) {
    const key = s.cwd || '(unknown project)';
    (byProject[key] ||= { path: key, name: path.basename(key) || key, sessions: [], live: false, activeTeammates: 0 }).sessions.push(s as Session);
  }
  // Watched repos are ADDITIVE, never a filter: they always appear as projects
  // (even with no activity yet, ready to host an orchestrator), and discovered
  // active work is always shown regardless of config.
  for (const repo of config.repos ?? []) {
    if (!byProject[repo]) byProject[repo] = { path: repo, name: path.basename(repo) || repo, sessions: [], live: false, activeTeammates: 0 };
  }
  const projects = Object.values(byProject).map(p => {
    p.sessions.sort((a, b) => Number(b.live) - Number(a.live) || b.id.localeCompare(a.id));
    p.live = p.sessions.some(s => s.live);
    p.activeTeammates = p.sessions.filter(s => s.live).flatMap(s => s.members.filter(m => !m.isLead)).length;
    return p;
  }).sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name));

  return { generatedAt: new Date().toISOString(), home: HOME, projects };
}
