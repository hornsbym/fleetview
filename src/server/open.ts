// POST /api/open — open a file in the user's editor (default `code -g`).
// Local, single-user tool; uses execFile (no shell) so paths can't inject.
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { readConfig } from '../features/projects/server';

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1 << 16) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function handleOpenRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/api/open') return false;
  if (req.method !== 'POST') { json(res, 405, { ok: false, reason: 'method-not-allowed' }); return true; }

  const body = await readBody(req);
  let filePath: string | undefined = body?.path;
  const repo: string | undefined = body?.repo;
  const line = Number(body?.line) || undefined;
  const col = Number(body?.col) || undefined;

  // Resolve a repo-relative path against its repo.
  if (filePath && !path.isAbsolute(filePath) && repo) filePath = path.resolve(repo, filePath);
  if (!filePath || !path.isAbsolute(filePath)) { json(res, 200, { ok: false, reason: 'bad-path' }); return true; }
  try {
    if (!(await stat(filePath)).isFile()) { json(res, 200, { ok: false, reason: 'not-a-file' }); return true; }
  } catch { json(res, 200, { ok: false, reason: 'not-found' }); return true; }

  const cfg = await readConfig();
  const editor = cfg.editor || 'code';
  const target = line ? `${filePath}:${line}${col ? `:${col}` : ''}` : filePath;

  // `-g` = go to file[:line[:col]] in the current window. execFile → no shell.
  execFile(editor, ['-g', target], (err) => {
    if (err) process.stderr.write(`[open] ${editor} failed: ${err.message}\n`);
  });
  json(res, 200, { ok: true, editor });
  return true;
}
