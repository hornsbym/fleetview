// Control-plane singleton: one OrchestratorClient per repo (get-or-create via the
// adapter), plus a bounded ring buffer of recent events so a freshly-connected SSE
// client can replay history. This module owns the ONLY subscription to each
// client's onEvent — it fans events out to SSE subscribers and buffers them.
import {
  createOrchestrator,
  type ControlSnapshot,
  type OrchestratorClient,
  type OrchestratorOptions,
  type OrchestratorStatus,
  type PermissionDecision,
  type PermissionRequest,
} from '../../../lib/claude-adapter/index';
import type { SeqEvent } from '../shared/events';

const RING_MAX = 500;

interface RepoState {
  client: OrchestratorClient;
  buffer: SeqEvent[];
  subs: Set<(e: SeqEvent) => void>;
  seq: number;
}

const repos = new Map<string, RepoState>();

/** Get-or-create the per-repo client + fan-out. Creating a client does NOT spawn a
    process — that only happens on start()/send(). Safe to call from any route. */
function ensure(repo: string, opts?: OrchestratorOptions): RepoState {
  const existing = repos.get(repo);
  if (existing) return existing;
  const client = createOrchestrator(repo, opts ?? {});
  const state: RepoState = { client, buffer: [], subs: new Set(), seq: 0 };
  client.onEvent((event) => {
    const se: SeqEvent = { seq: ++state.seq, at: Date.now(), event };
    state.buffer.push(se);
    if (state.buffer.length > RING_MAX) state.buffer.shift();
    for (const cb of state.subs) {
      try {
        cb(se);
      } catch {
        /* one bad subscriber must not break the fan-out */
      }
    }
  });
  repos.set(repo, state);
  return state;
}

export function startOrchestrator(
  repo: string,
  opts?: OrchestratorOptions & { resume?: string },
): { status: OrchestratorStatus; sessionId: string | null } {
  const st = ensure(repo, opts);
  // A start begins a new/resumed session: clear the replay buffer so a fresh SSE
  // client doesn't inherit the previous session's transcript (seq stays monotonic
  // so an already-connected client still advances correctly).
  st.buffer.length = 0;
  st.client.start(opts?.resume ? { resume: opts.resume } : undefined);
  return { status: st.client.status(), sessionId: st.client.sessionId() };
}

export function stopOrchestrator(repo: string): void {
  repos.get(repo)?.client.stop();
}

/** Resolve a parked tool-permission request (allow / always / deny). */
export function respondPermission(repo: string, requestId: string, decision: PermissionDecision): void {
  repos.get(repo)?.client.respondPermission(requestId, decision);
}

/** What the control plane knows about every repo it has a client for — merged into
    the monitor snapshot so liveness/needs-approval survive the CLI deleting config.json. */
export function controlSnapshot(): ControlSnapshot {
  return {
    sessions: [...repos.entries()].map(([repo, st]) => ({
      repo,
      sessionId: st.client.sessionId(),
      status: st.client.status(),
      pendingApprovals: st.client.pendingPermissions().length,
    })),
  };
}

/** Stop every orchestrator — call on server shutdown so no `claude` children leak. */
export function stopAll(): void {
  for (const st of repos.values()) {
    try { st.client.stop(); } catch { /* best effort */ }
  }
}

export function sendToOrchestrator(repo: string, text: string): void {
  ensure(repo).client.send(text);
}

/** Non-creating: unknown repos report idle so status probes don't spawn clients. */
export function getOrchestratorStatus(repo: string): {
  status: OrchestratorStatus;
  sessionId: string | null;
  pending: PermissionRequest[];
} {
  const st = repos.get(repo);
  return st
    ? { status: st.client.status(), sessionId: st.client.sessionId(), pending: st.client.pendingPermissions() }
    : { status: 'idle', sessionId: null, pending: [] };
}

/** Replay buffer entries newer than `sinceSeq` (0 → the whole buffer). */
export function bufferSince(repo: string, sinceSeq = 0): SeqEvent[] {
  const st = ensure(repo);
  return sinceSeq > 0 ? st.buffer.filter((e) => e.seq > sinceSeq) : st.buffer.slice();
}

/** Subscribe to live events for a repo; returns an unsubscribe fn. */
export function subscribe(repo: string, cb: (e: SeqEvent) => void): () => void {
  const st = ensure(repo);
  st.subs.add(cb);
  return () => {
    st.subs.delete(cb);
  };
}
