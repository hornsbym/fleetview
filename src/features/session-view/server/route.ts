// Read-only session routes + the permission decision endpoint.
//
// Everything here is keyed by SESSION id, not repo — one repo commonly runs
// several Claude Code sessions at once, and v1's per-repo keying would show you
// one session's transcript on another session's page.
//
// There is deliberately no start / stop / message route. The terminal session is
// the source of truth; FleetView reads it.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readSessionHistory, readSubagentHistory, type PermissionDecision } from '../../../lib/claude-adapter/index';
import { bufferSince, subscribe, pendingPermissions, resolvePermission } from '../../../server/bus';

const HEARTBEAT_MS = 15_000;

const json = (res: ServerResponse, body: unknown, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1 << 20) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function stream(req: IncomingMessage, res: ServerResponse, sessionId: string) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const lastId = Number(req.headers['last-event-id']) || 0;
  let lastSent = lastId;

  const send = (se: { seq: number; event: unknown }) => {
    if (se.seq <= lastSent) return;
    lastSent = se.seq;
    res.write(`id: ${se.seq}\ndata: ${JSON.stringify(se.event)}\n\n`);
  };

  // Subscribe BEFORE flushing the backlog so nothing slips between the two.
  const unsubscribe = subscribe(sessionId, send);
  for (const se of bufferSince(sessionId, lastId)) send(se);

  const hb = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => { clearInterval(hb); unsubscribe(); });
}

export async function handleSessionRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/session/')) return false;

  try {
    const sessionId = url.searchParams.get('sessionId') ?? '';

    if (req.method === 'GET' && url.pathname === '/api/session/stream') {
      if (!sessionId) { json(res, { ok: false, reason: 'missing-sessionId' }); return true; }
      stream(req, res, sessionId);
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/session/history') {
      if (!sessionId) { json(res, { ok: false, reason: 'missing-sessionId' }); return true; }
      json(res, { ok: true, items: await readSessionHistory(sessionId) });
      return true;
    }

    // Read-only teammate page: one subagent's transcript within a session.
    if (req.method === 'GET' && url.pathname === '/api/session/agent') {
      const agentId = url.searchParams.get('agentId') ?? '';
      if (!sessionId || !agentId) { json(res, { ok: false, reason: 'missing-params' }); return true; }
      json(res, { ok: true, items: await readSubagentHistory(sessionId, agentId) });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/session/pending') {
      json(res, { ok: true, pending: pendingPermissions(sessionId || undefined) });
      return true;
    }

    // The one write: answering a permission the session asked for.
    if (req.method === 'POST' && url.pathname === '/api/session/permission') {
      const body = await readBody(req);
      const decision = body?.decision as PermissionDecision;
      if (!body?.requestId || !['allow', 'deny', 'always'].includes(decision)) {
        json(res, { ok: false, reason: 'bad-request' });
        return true;
      }
      const ok = resolvePermission(body.requestId, decision);
      json(res, { ok, ...(ok ? {} : { reason: 'unknown-request' }) });
      return true;
    }

    json(res, { ok: false, reason: 'not-found' }, 404);
    return true;
  } catch {
    if (!res.writableEnded) json(res, { ok: false, reason: 'server-error' });
    return true;
  }
}
