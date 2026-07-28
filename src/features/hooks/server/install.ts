// Installs FleetView's hook block into ~/.claude/settings.json.
//
// USER-level on purpose: one write covers every repo you ever open, where a
// project-level block would need repeating per repo. This is the only file
// FleetView writes outside its own config, so it is strictly opt-in (a button),
// merges rather than clobbers, and can be removed again.
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

const SETTINGS = path.join(homedir(), '.claude', 'settings.json');

/** Marks the entries we own, so uninstall never touches a hand-written hook. */
const MARK = 'fleetview';

export interface HookStatus {
  installed: boolean;
  path: string;
  /** Hook events we currently own in the file. */
  events: string[];
  port: number;
  /** Set when settings.json exists but could not be parsed — we refuse to write. */
  error?: string;
}

/** Fire-and-forget activity events. Push replaces polling for these. */
const EVENT_HOOKS = [
  'Notification', 'SubagentStart', 'SubagentStop',
  'TaskCreated', 'TaskCompleted', 'WorktreeCreate', 'WorktreeRemove',
];

/** The UserPromptSubmit hook command that captures terminal identity and posts
 *  it to FleetView. Runs in the session's shell, so it can read env vars the
 *  HTTP hook transport can't (TERM_PROGRAM, TERM_SESSION_ID, etc.). */
function terminalIdentityCommand(port: number): string {
  // Uses env vars for terminal identity and CLAUDE_CODE_SESSION_ID for the
  // session link. The command must be a single shell expression.
  return `curl -sS -X POST http://127.0.0.1:${port}/api/hooks/terminal-identity -H 'Content-Type: application/json' -d "{\\"session_id\\":\\"$CLAUDE_CODE_SESSION_ID\\",\\"term_program\\":\\"$TERM_PROGRAM\\",\\"term_session_id\\":\\"$TERM_SESSION_ID\\",\\"iterm_session_id\\":\\"$ITERM_SESSION_ID\\",\\"tty\\":\\"$(tty 2>/dev/null)\\"}" >/dev/null 2>&1 || true`;
}

function block(port: number) {
  const permission = {
    matcher: '',
    hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hooks/permission`, [MARK]: true }],
  };
  const event = (name: string) => ({
    matcher: '',
    hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hooks/event?event=${name}`, [MARK]: true }],
  });
  const terminalIdentity = {
    matcher: '',
    hooks: [{ type: 'command', command: terminalIdentityCommand(port), [MARK]: true }],
  };
  const hooks: Record<string, unknown[]> = {
    PermissionRequest: [permission],
    UserPromptSubmit: [terminalIdentity],
  };
  for (const e of EVENT_HOOKS) hooks[e] = [event(e)];
  return hooks;
}

const isOurs = (entry: any) =>
  Array.isArray(entry?.hooks) && entry.hooks.some((h: any) => h?.[MARK] === true);

async function readSettings(): Promise<{ json: any; error?: string }> {
  let raw: string;
  try { raw = await readFile(SETTINGS, 'utf8'); } catch { return { json: {} }; }
  try { return { json: JSON.parse(raw) }; } catch (e: any) {
    return { json: null, error: `settings.json is not valid JSON (${e?.message || 'parse error'})` };
  }
}

// Write via a temp file + rename so a crash mid-write can't truncate the user's
// settings — losing this file would drop their permission allow-lists too.
async function writeSettings(json: unknown): Promise<void> {
  const tmp = `${SETTINGS}.fleetview-tmp`;
  await writeFile(tmp, JSON.stringify(json, null, 2) + '\n', 'utf8');
  await rename(tmp, SETTINGS);
}

export async function hookStatus(port: number): Promise<HookStatus> {
  const { json, error } = await readSettings();
  if (error) return { installed: false, path: SETTINGS, events: [], port, error };
  const hooks = json?.hooks ?? {};
  const events = Object.keys(hooks).filter(k => (hooks[k] ?? []).some(isOurs));
  return { installed: events.includes('PermissionRequest'), path: SETTINGS, events, port };
}

export async function installHooks(port: number): Promise<HookStatus> {
  const { json, error } = await readSettings();
  if (error) return { installed: false, path: SETTINGS, events: [], port, error };

  const next = { ...(json ?? {}) };
  const hooks: Record<string, any[]> = { ...(next.hooks ?? {}) };
  for (const [event, entries] of Object.entries(block(port))) {
    // Drop any previous FleetView entry (e.g. an old port), keep everything else.
    const kept = (hooks[event] ?? []).filter((e: any) => !isOurs(e));
    hooks[event] = [...kept, ...entries];
  }
  next.hooks = hooks;
  await writeSettings(next);
  return hookStatus(port);
}

export async function uninstallHooks(port: number): Promise<HookStatus> {
  const { json, error } = await readSettings();
  if (error) return { installed: false, path: SETTINGS, events: [], port, error };

  const next = { ...(json ?? {}) };
  const hooks: Record<string, any[]> = { ...(next.hooks ?? {}) };
  for (const event of Object.keys(hooks)) {
    hooks[event] = (hooks[event] ?? []).filter((e: any) => !isOurs(e));
    if (!hooks[event].length) delete hooks[event];
  }
  next.hooks = hooks;
  if (!Object.keys(hooks).length) delete next.hooks;
  await writeSettings(next);
  return hookStatus(port);
}
