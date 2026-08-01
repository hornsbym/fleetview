// In-memory store for terminal identity metadata, keyed by session id.
// Populated via the UserPromptSubmit hook; consumed by the focus endpoint.
//
// Persisted to disk so identities survive server restarts (tsx watch).

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface TerminalIdentity {
  sessionId: string;
  pid: number | null;
  termProgram: string | null;
  termSessionId: string | null;
  itermSessionId: string | null;
  tty: string | null;
  capturedAt: string;
}

const PERSIST_PATH = path.join(tmpdir(), 'fleetview-terminal-identities.json');

function loadFromDisk(): [string, TerminalIdentity][] {
  try {
    const data = JSON.parse(readFileSync(PERSIST_PATH, 'utf8'));
    if (Array.isArray(data)) return data;
  } catch { /* first run or corrupt file */ }
  return [];
}

function saveToDisk() {
  try {
    writeFileSync(PERSIST_PATH, JSON.stringify([...store.entries()]), 'utf8');
  } catch { /* best effort */ }
}

const store = new Map<string, TerminalIdentity>(loadFromDisk());

export function setTerminalIdentity(id: TerminalIdentity): void {
  store.set(id.sessionId, id);
  saveToDisk();
}

export function getTerminalIdentity(sessionId: string): TerminalIdentity | null {
  return store.get(sessionId) ?? null;
}

export function allTerminalIdentities(): Map<string, TerminalIdentity> {
  return store;
}
