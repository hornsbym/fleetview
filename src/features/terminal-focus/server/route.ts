// Terminal focus routes:
//   POST /api/hooks/terminal-identity — captures terminal env from a hook
//   POST /api/session/focus           — raises the terminal window for a session
//   GET  /api/session/terminal        — returns stored terminal identity for a session
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTerminalIdentity, getTerminalIdentity } from './store';
import { focusTerminal } from './focus';

function json(res: ServerResponse, body: unknown, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1 << 16) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

interface TerminalHookPayload {
  session_id?: string;
  term_program?: string;
  term_session_id?: string;
  iterm_session_id?: string;
  tty?: string;
}

export async function handleTerminalFocusRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // Hook endpoint: Claude Code pushes terminal identity here on UserPromptSubmit
  if (req.method === 'POST' && url.pathname === '/api/hooks/terminal-identity') {
    const body: TerminalHookPayload = await readBody(req);
    if (!body.session_id) { json(res, {}); return true; }

    setTerminalIdentity({
      sessionId: body.session_id,
      pid: null,
      termProgram: body.term_program ?? null,
      termSessionId: body.term_session_id ?? null,
      itermSessionId: body.iterm_session_id ?? null,
      tty: body.tty ?? null,
      capturedAt: new Date().toISOString(),
    });

    json(res, {});
    return true;
  }

  // Query stored terminal identity for a session
  if (req.method === 'GET' && url.pathname === '/api/session/terminal') {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) { json(res, { ok: false, reason: 'missing-sessionId' }); return true; }
    const identity = getTerminalIdentity(sessionId);
    json(res, { ok: true, identity });
    return true;
  }

  // Focus action: raise the terminal window for a session
  if (req.method === 'POST' && url.pathname === '/api/session/focus') {
    const body = await readBody(req);
    const sessionId = body?.sessionId;
    const cwd = body?.cwd;
    if (!sessionId) { json(res, { ok: false, reason: 'missing-sessionId' }); return true; }
    const result = await focusTerminal(sessionId, cwd);
    json(res, result);
    return true;
  }

  return false;
}
