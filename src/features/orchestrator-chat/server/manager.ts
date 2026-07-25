// Control-plane singleton: one OrchestratorClient per repo (get-or-create via the
// adapter), plus a bounded ring buffer of recent events so a freshly-connected SSE
// client can replay history. This module owns the ONLY subscription to each
// client's onEvent — it fans events out to SSE subscribers and buffers them.
import {
  createOrchestrator,
  type OrchestratorClient,
  type OrchestratorOptions,
  type OrchestratorStatus,
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
  opts?: OrchestratorOptions,
): { status: OrchestratorStatus; sessionId: string | null } {
  // opts only take effect on first create for a repo (v1: one posture per repo).
  const st = ensure(repo, opts);
  st.client.start();
  return { status: st.client.status(), sessionId: st.client.sessionId() };
}

export function stopOrchestrator(repo: string): void {
  repos.get(repo)?.client.stop();
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
} {
  const st = repos.get(repo);
  return st
    ? { status: st.client.status(), sessionId: st.client.sessionId() }
    : { status: 'idle', sessionId: null };
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
