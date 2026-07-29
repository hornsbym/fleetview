// Session-keyed event bus + parked-permission registry.
//
// Server infrastructure, not a feature: the hooks bridge PUBLISHES here and
// session-view SUBSCRIBES, so neither has to reach into the other's internals.
//
// Two things changed from v1's per-repo manager:
//   • Keyed by SESSION, not repo. A single repo routinely has several concurrent
//     Claude Code sessions (verified: three at once in this repo), and a repo-keyed
//     bus cross-contaminates their transcripts and permission lists.
//   • Nothing here owns a process. A parked permission is a held HTTP response to
//     Claude Code's own PermissionRequest hook — we answer a question the session
//     asked, we don't drive it.
import type { ServerResponse } from 'node:http';
import type { PermissionDecision, PermissionRequest, PendingSnapshot, SessionEvent } from '../lib/claude-adapter/index';

const RING_MAX = 500;

export interface SeqEvent { seq: number; at: number; event: SessionEvent }

interface SessionState {
  buffer: SeqEvent[];
  subs: Set<(e: SeqEvent) => void>;
  seq: number;
}

const sessions = new Map<string, SessionState>();

function state(sessionId: string): SessionState {
  let st = sessions.get(sessionId);
  if (!st) sessions.set(sessionId, (st = { buffer: [], subs: new Set(), seq: 0 }));
  return st;
}

export function publish(sessionId: string, event: SessionEvent): void {
  const st = state(sessionId);
  const se: SeqEvent = { seq: ++st.seq, at: Date.now(), event };
  st.buffer.push(se);
  if (st.buffer.length > RING_MAX) st.buffer.shift();
  for (const cb of st.subs) {
    try { cb(se); } catch { /* one bad subscriber must not break the fan-out */ }
  }
}

/** Replay buffer entries newer than `sinceSeq` (0 → the whole buffer). */
export function bufferSince(sessionId: string, sinceSeq = 0): SeqEvent[] {
  const st = state(sessionId);
  return sinceSeq > 0 ? st.buffer.filter(e => e.seq > sinceSeq) : st.buffer.slice();
}

export function subscribe(sessionId: string, cb: (e: SeqEvent) => void): () => void {
  const st = state(sessionId);
  st.subs.add(cb);
  return () => { st.subs.delete(cb); };
}

// --- Parked permissions -----------------------------------------------------

interface Parked {
  req: PermissionRequest;
  /** Writes the decision as the hook's HTTP response body and ends it. */
  settle: (decision: PermissionDecision | 'timeout', extra?: { updatedInput?: unknown }) => void;
  timer: NodeJS.Timeout;
}

const parked = new Map<string, Parked>();

/**
 * Park a permission request until the user decides (or `timeoutMs` elapses).
 *
 * Fail-open on timeout is a CORRECTNESS requirement, not a nicety: the hook
 * BLOCKS the terminal while we hold the response. If the user is away from the
 * browser we must hand the decision back to the terminal rather than stall it —
 * Claude Code's own default window is 10 minutes, which is far too long to leave
 * a session frozen. Returning no opinion lets the TUI prompt normally.
 */
export function park(
  req: PermissionRequest,
  settle: (decision: PermissionDecision | 'timeout', extra?: { updatedInput?: unknown }) => void,
  timeoutMs: number,
): void {
  const timer = setTimeout(() => {
    const p = parked.get(req.requestId);
    if (!p) return;
    parked.delete(req.requestId);
    p.settle('timeout');
    publish(groupOf(req), { kind: 'permission_resolved', sessionId: groupOf(req), permission: req });
  }, timeoutMs);
  // Don't hold the process open just for a pending prompt.
  timer.unref?.();

  parked.set(req.requestId, { req, settle, timer });
  publish(groupOf(req), { kind: 'permission', sessionId: groupOf(req), permission: req });
}

/** The session a request should be DISPLAYED under: a subagent's card belongs on
 *  its parent's page, since that's the page the user is looking at. */
function groupOf(req: PermissionRequest): string {
  return req.parentSessionId || req.sessionId;
}

export function resolvePermission(requestId: string, decision: PermissionDecision, extra?: { updatedInput?: unknown }): boolean {
  const p = parked.get(requestId);
  if (!p) return false;
  parked.delete(requestId);
  clearTimeout(p.timer);
  p.settle(decision, extra);
  publish(groupOf(p.req), {
    kind: 'permission_resolved', sessionId: groupOf(p.req), permission: p.req, decision,
  });
  return true;
}

export function cancelPermission(requestId: string): boolean {
  const p = parked.get(requestId);
  if (!p) return false;
  parked.delete(requestId);
  clearTimeout(p.timer);
  publish(groupOf(p.req), {
    kind: 'permission_resolved', sessionId: groupOf(p.req), permission: p.req,
  });
  return true;
}

/** Parked requests, optionally scoped to the session page they display under. */
export function pendingPermissions(sessionId?: string): PermissionRequest[] {
  const all = [...parked.values()].map(p => p.req);
  return sessionId ? all.filter(r => groupOf(r) === sessionId) : all;
}

/** Per-session counts for the fleet snapshot's attention badges. */
export function pendingSnapshot(): PendingSnapshot {
  const pendingBySession: Record<string, number> = {};
  const cwdBySession: Record<string, string> = {};
  for (const p of parked.values()) {
    const k = groupOf(p.req);
    pendingBySession[k] = (pendingBySession[k] ?? 0) + 1;
    if (p.req.cwd) cwdBySession[k] = p.req.cwd;
  }
  return { pendingBySession, cwdBySession };
}

/** Release everything on shutdown so no terminal session is left blocked. */
export function releaseAll(): void {
  for (const p of parked.values()) {
    clearTimeout(p.timer);
    try { p.settle('timeout'); } catch { /* best effort */ }
  }
  parked.clear();
}

/** Bind a held ServerResponse to a parked request. Exported so the hooks route
 *  keeps all of its HTTP-shaped concerns in one place. */
export function settlerFor(res: ServerResponse, body: (d: PermissionDecision | 'timeout', extra?: { updatedInput?: unknown }) => unknown) {
  let done = false;
  return (decision: PermissionDecision | 'timeout', extra?: { updatedInput?: unknown }) => {
    if (done || res.writableEnded) return;
    done = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body(decision, extra)));
  };
}
