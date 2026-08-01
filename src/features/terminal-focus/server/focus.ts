// Focus a terminal window by session id. Uses osascript (macOS) to raise the
// window matching the terminal identity we captured via the hook.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { getTerminalIdentity, type TerminalIdentity } from './store';

const pexec = promisify(execFile);

export interface FocusResult {
  ok: boolean;
  method?: string;
  reason?: string;
}

export async function focusTerminal(sessionId: string, cwd?: string | null): Promise<FocusResult> {
  const id = getTerminalIdentity(sessionId);
  if (!id) return { ok: false, reason: 'no-terminal-identity' };

  if (id.termProgram === 'iTerm.app' || id.termProgram === 'iTerm2') {
    return focusITerm(id);
  }
  if (id.termProgram === 'Apple_Terminal') {
    return focusAppleTerminal(id);
  }
  if (id.termProgram === 'vscode') {
    return focusVSCode(id, cwd);
  }
  if (id.termProgram === 'WezTerm') {
    return focusWezTerm(id);
  }

  // Fallback: activate whatever app the TERM_PROGRAM says it is.
  if (id.termProgram) {
    return focusGeneric(id.termProgram);
  }

  return { ok: false, reason: 'unknown-terminal' };
}

async function focusITerm(id: TerminalIdentity): Promise<FocusResult> {
  const targetId = id.itermSessionId || id.termSessionId;
  if (!targetId) {
    return focusGeneric('iTerm2');
  }

  const script = `
    tell application "iTerm2"
      activate
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if id of s contains "${escapeAS(targetId)}" then
              select t
              return "focused"
            end if
          end repeat
        end repeat
      end repeat
    end tell
    return "not-found"
  `;

  try {
    const { stdout } = await pexec('osascript', ['-e', script], { timeout: 5000 });
    const found = stdout.trim() === 'focused';
    return { ok: found, method: 'iterm2-session-id', ...(found ? {} : { reason: 'session-not-found-in-iterm' }) };
  } catch (e: any) {
    return { ok: false, method: 'iterm2-session-id', reason: e?.message || 'osascript-failed' };
  }
}

async function focusAppleTerminal(id: TerminalIdentity): Promise<FocusResult> {
  const tty = id.tty;
  if (!tty) {
    return focusGeneric('Terminal');
  }

  const script = `
    tell application "Terminal"
      activate
      repeat with w in windows
        repeat with t in tabs of w
          if tty of t is "${escapeAS(tty)}" then
            set selected tab of w to t
            set index of w to 1
            return "focused"
          end if
        end repeat
      end repeat
    end tell
    return "not-found"
  `;

  try {
    const { stdout } = await pexec('osascript', ['-e', script], { timeout: 5000 });
    const found = stdout.trim() === 'focused';
    return { ok: found, method: 'terminal-tty', ...(found ? {} : { reason: 'tty-not-found' }) };
  } catch (e: any) {
    return { ok: false, method: 'terminal-tty', reason: e?.message || 'osascript-failed' };
  }
}

/** The folder VS Code has open is the workspace root, which is rarely the
 *  session's cwd: an agent working in a git worktree (or any subdirectory) sits
 *  below it. `git --git-common-dir` collapses both cases back to the main repo
 *  root, which is the window actually hosting the terminal. */
async function workspaceRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await pexec(
      'git',
      ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { timeout: 3000 },
    );
    const common = stdout.trim();
    return common.endsWith('/.git') ? common.slice(0, -'/.git'.length) : null;
  } catch {
    return null;
  }
}

/** Basenames of the folders open in VS Code windows right now. `code --status`
 *  is the only enumeration the CLI offers and it reports names, not paths — good
 *  enough, because we use it purely as a guard against opening a new window. */
async function openWindowFolders(): Promise<string[] | null> {
  try {
    const { stdout } = await pexec('code', ['--status'], { timeout: 5000 });
    return [...stdout.matchAll(/^\|\s+Folder \(([^)]+)\)/gm)].map(m => m[1]);
  } catch {
    return null;
  }
}

async function focusVSCode(id: TerminalIdentity, cwd?: string | null): Promise<FocusResult> {
  // Passing `code` a folder it doesn't already have open spawns a NEW window
  // rather than raising one, so only ever hand it a path we've confirmed is open.
  const root = cwd ? (await workspaceRoot(cwd)) ?? cwd : null;
  if (root) {
    const open = await openWindowFolders();
    if (open?.includes(path.basename(root))) {
      try {
        await pexec('code', [root], { timeout: 5000 });
        return { ok: true, method: 'vscode-folder' };
      } catch { /* fall through to generic activate */ }
    }
  }

  // Can't pin the window down — activate the app instead. Loses multi-window
  // targeting, but never leaves a stray window behind.
  const result = await focusGeneric('Visual Studio Code');
  return { ...result, method: 'vscode-activate' };
}

async function focusWezTerm(id: TerminalIdentity): Promise<FocusResult> {
  const script = `
    tell application "WezTerm"
      activate
    end tell
  `;
  try {
    await pexec('osascript', ['-e', script], { timeout: 5000 });
    return { ok: true, method: 'wezterm-activate' };
  } catch (e: any) {
    return { ok: false, method: 'wezterm-activate', reason: e?.message || 'osascript-failed' };
  }
}

async function focusGeneric(appName: string): Promise<FocusResult> {
  const script = `
    tell application "${escapeAS(appName)}"
      activate
    end tell
  `;
  try {
    await pexec('osascript', ['-e', script], { timeout: 5000 });
    return { ok: true, method: 'generic-activate' };
  } catch (e: any) {
    return { ok: false, method: 'generic-activate', reason: e?.message || 'osascript-failed' };
  }
}

function escapeAS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
