// Control-plane HTTP surface for orchestrator-chat. The lead mounts this from the
// main http handler: `if (await handleOrchestratorRoute(req, res)) return;` before
// the SPA fallback (mirrors handleConfigRoute). Servers report ({ ok, ... }); the
// UI decides how to render.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OkResponse, SeqEvent, StatusResponse } from '../shared/events';
import {
  bufferSince,
  getOrchestratorStatus,
  sendToOrchestrator,
  startOrchestrator,
  stopOrchestrator,
  subscribe,
} from './manager';

const HEARTBEAT_MS = 15000;

function json(res: ServerResponse, code: number, body: OkResponse | StatusResponse) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** SSE: replay the ring buffer, then stream live events. Each frame carries an
    `id:` (the seq) so EventSource auto-reconnects resume via Last-Event-ID. */
function stream(req: IncomingMessage, res: ServerResponse, repo: string) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const lastId = Number(req.headers['last-event-id']) || 0;
  let lastSent = lastId;
  const write = (se: SeqEvent) => {
    if (se.seq <= lastSent) return;
    lastSent = se.seq;
    res.write(`id: ${se.seq}\ndata: ${JSON.stringify(se.event)}\n\n`);
  };

  // Subscribe first, then flush the replay buffer. Both paths guard on seq, and
  // the handoff is synchronous (single-threaded), so nothing is dropped or duped.
  const unsub = subscribe(repo, write);
  for (const se of bufferSince(repo, lastId)) write(se);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
    res.end();
  });
}

/**
 * Handles /api/orchestrator/*. Returns true when it owned the request (response
 * written or SSE opened), false to let the caller fall through to other routes.
 */
export async function handleOrchestratorRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/orchestrator/')) return false;

  const method = (req.method || 'GET').toUpperCase();
  try {
    if (url.pathname === '/api/orchestrator/stream' && method === 'GET') {
      const repo = url.searchParams.get('repo') || '';
      if (!repo) {
        json(res, 400, { ok: false, reason: 'missing-repo' });
        return true;
      }
      stream(req, res, repo);
      return true;
    }

    if (url.pathname === '/api/orchestrator/status' && method === 'GET') {
      const repo = url.searchParams.get('repo') || '';
      if (!repo) {
        json(res, 200, { ok: false, reason: 'missing-repo' });
        return true;
      }
      const { status, sessionId } = getOrchestratorStatus(repo);
      json(res, 200, { ok: true, status, sessionId });
      return true;
    }

    if (method === 'POST') {
      const body = await readBody(req);
      const repo = str(body.repo);
      if (!repo) {
        json(res, 200, { ok: false, reason: 'missing-repo' });
        return true;
      }

      if (url.pathname === '/api/orchestrator/start') {
        const { status, sessionId } = startOrchestrator(repo, {
          permissionMode: str(body.permissionMode) || undefined,
          model: str(body.model) || undefined,
        });
        json(res, 200, { ok: true, status, sessionId });
        return true;
      }
      if (url.pathname === '/api/orchestrator/stop') {
        stopOrchestrator(repo);
        json(res, 200, { ok: true });
        return true;
      }
      if (url.pathname === '/api/orchestrator/message') {
        const text = str(body.text);
        if (!text.trim()) {
          json(res, 200, { ok: false, reason: 'missing-text' });
          return true;
        }
        sendToOrchestrator(repo, text);
        json(res, 200, { ok: true });
        return true;
      }
    }

    json(res, 404, { ok: false, reason: 'not-found' });
    return true;
  } catch {
    // Malformed body or unexpected error — report, don't crash the server.
    json(res, 200, { ok: false, reason: 'server-error' });
    return true;
  }
}
