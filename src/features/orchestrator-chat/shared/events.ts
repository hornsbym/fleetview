// DTO types shared by the orchestrator-chat server + web. Type-only (erased at
// build), so importing this from browser code pulls in no Node/adapter runtime.
// The adapter's OrchestratorEvent/Status are the wire shape; we re-export them
// plus the SSE/REST envelopes.
import type { OrchestratorEvent, OrchestratorStatus } from '../../../lib/claude-adapter/types';

export type { OrchestratorEvent, OrchestratorStatus };

/** A buffered/streamed event tagged with a per-repo monotonic sequence id. The
    seq is emitted as the SSE `id:` so a reconnecting client resumes via
    Last-Event-ID instead of re-replaying the whole ring buffer. */
export interface SeqEvent {
  seq: number;
  at: number;
  event: OrchestratorEvent;
}

// --- REST request bodies (POST) ---
export interface StartRequest {
  repo: string;
  permissionMode?: string;
  model?: string;
}
export interface RepoRequest {
  repo: string;
}
export interface MessageRequest {
  repo: string;
  text: string;
}

// --- REST responses (servers report; the UI decides) ---
export interface OkResponse {
  ok: boolean;
  /** Machine-readable failure code when ok === false. */
  reason?: string;
}
export interface StatusResponse {
  ok: boolean;
  status?: OrchestratorStatus;
  sessionId?: string | null;
  reason?: string;
}
