// In-memory store for terminal identity metadata, keyed by session id.
// Populated via the UserPromptSubmit hook; consumed by the focus endpoint.
//
// This is ephemeral — terminal identity is only useful while the session is
// alive, and re-captured on every prompt submit, so persistence is unnecessary.

export interface TerminalIdentity {
  sessionId: string;
  pid: number | null;
  termProgram: string | null;
  termSessionId: string | null;
  itermSessionId: string | null;
  tty: string | null;
  capturedAt: string;
}

const store = new Map<string, TerminalIdentity>();

export function setTerminalIdentity(id: TerminalIdentity): void {
  store.set(id.sessionId, id);
}

export function getTerminalIdentity(sessionId: string): TerminalIdentity | null {
  return store.get(sessionId) ?? null;
}

export function allTerminalIdentities(): Map<string, TerminalIdentity> {
  return store;
}
