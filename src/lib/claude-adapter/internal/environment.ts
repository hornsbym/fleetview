// Extract session environment metadata from a session's JSONL transcript.
// Basic info (cwd, model, version) comes from the head of the file.
// MCP servers can connect at any point, so we grep the full transcript for
// deferred_tools_delta entries to find all servers.
import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { readHead } from './transcripts';
import { PROJECTS, encodeCwd } from './paths';
import type { SessionEnvironment } from '../types';

export async function readSessionEnvironment(sessionId: string, cwd?: string | null): Promise<SessionEnvironment | null> {
  const tp = await locateTranscript(sessionId, cwd);
  if (!tp) return null;
  return parseTranscript(tp);
}

async function locateTranscript(sessionId: string, cwd?: string | null): Promise<string | null> {
  if (cwd) {
    const direct = path.join(PROJECTS, encodeCwd(cwd), `${sessionId}.jsonl`);
    try { await stat(direct); return direct; } catch { /* fall through */ }
  }
  let dirs: string[] = [];
  try {
    dirs = (await readdir(PROJECTS, { withFileTypes: true }))
      .filter(d => d.isDirectory()).map(d => d.name);
  } catch { return null; }
  for (const d of dirs) {
    const p = path.join(PROJECTS, d, `${sessionId}.jsonl`);
    try { await stat(p); return p; } catch { /* keep looking */ }
  }
  return null;
}

async function parseTranscript(tp: string): Promise<SessionEnvironment | null> {
  const env: SessionEnvironment = {
    cwd: '', model: '', skills: [], tools: [], mcpServers: [], permissionMode: '', version: '',
  };

  // First pass: read head for basic metadata (cwd, model, version, skills).
  let head: string;
  try { head = await readHead(tp, 65536); } catch { return null; }

  let found = false;
  for (const line of head.split('\n')) {
    if (!line) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }

    if (o?.type === 'system' && o?.subtype === 'init') {
      env.cwd = typeof o.cwd === 'string' ? o.cwd : '';
      env.model = typeof o.model === 'string' ? o.model : '';
      env.skills = Array.isArray(o.skills) ? o.skills.filter((s: unknown) => typeof s === 'string') : [];
      env.tools = Array.isArray(o.tools) ? o.tools.filter((t: unknown) => typeof t === 'string') : [];
      env.mcpServers = Array.isArray(o.mcp_servers)
        ? o.mcp_servers
            .filter((m: any) => m && typeof m.name === 'string')
            .map((m: any) => ({ name: m.name, status: typeof m.status === 'string' ? m.status : 'unknown' }))
        : [];
      env.permissionMode = typeof o.permissionMode === 'string' ? o.permissionMode : '';
      env.version = typeof o.claude_code_version === 'string' ? o.claude_code_version : '';
      return env;
    }

    if (o?.type === 'attachment' && !env.cwd) {
      env.cwd = typeof o.cwd === 'string' ? o.cwd : '';
      env.version = typeof o.version === 'string' ? o.version : '';
      found = true;
    }
    if (o?.type === 'permission-mode' && typeof o.permissionMode === 'string') {
      env.permissionMode = o.permissionMode;
      found = true;
    }
    if (o?.type === 'attachment') {
      const a = o.attachment;
      if (a?.type === 'skill_listing' && Array.isArray(a.names) && env.skills.length === 0) {
        env.skills = a.names.filter((s: unknown) => typeof s === 'string');
        found = true;
      }
    }
    if (o?.type === 'assistant' && !env.model) {
      const model = o?.message?.model;
      if (typeof model === 'string') { env.model = model; found = true; }
    }
  }

  // Second pass: stream the full file but only parse lines containing
  // "deferred_tools_delta" to find all MCP servers (they can connect late).
  const knownServers = new Set<string>();
  const rl = createInterface({ input: createReadStream(tp, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('deferred_tools_delta')) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    const a = o?.attachment;
    if (a?.type !== 'deferred_tools_delta' || !Array.isArray(a.addedNames)) continue;
    for (const n of a.addedNames) {
      if (typeof n === 'string' && n.startsWith('mcp__')) {
        const name = n.split('__')[1];
        if (!knownServers.has(name)) {
          knownServers.add(name);
          env.mcpServers.push({ name, status: 'connected' });
        }
      }
    }
    found = true;
  }

  return found ? env : null;
}
