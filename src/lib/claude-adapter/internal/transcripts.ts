// Parsing of Claude Code transcript JSONL. This is the most version-fragile code
// in FleetView — the format is internal to CC and can change between releases.
// It is deliberately isolated here and parses defensively; on an unrecognized
// shape it returns nulls rather than throwing, so features degrade gracefully.
import { open } from 'node:fs/promises';
import type { PlanItem } from '../types';

const TAIL = 96 * 1024;

export async function readHead(p: string, n: number): Promise<string> {
  const fh = await open(p, 'r');
  try {
    const b = Buffer.alloc(n);
    const { bytesRead } = await fh.read(b, 0, n, 0);
    return b.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

export async function readTail(p: string, n = TAIL): Promise<string> {
  const fh = await open(p, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - n);
    const len = size - start;
    const b = Buffer.alloc(len);
    const { bytesRead } = await fh.read(b, 0, len, start);
    return b.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

const base = (f: unknown) => (f ? String(f).split('/').pop() ?? '' : '');

/** Turn a tool_use block into a one-line "what it's doing now". */
export function summarizeTool(name: string, input: any = {}): string {
  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit':
      return `${name} ${base(input.file_path)}`;
    case 'Bash':
      return `Bash: ${input.description || String(input.command || '').slice(0, 70)}`;
    case 'Grep': return `Grep ${input.pattern || ''}`;
    case 'Glob': return `Glob ${input.pattern || ''}`;
    case 'Agent': case 'Task':
      return `Spawn ${input.subagent_type || 'agent'}${input.description ? ': ' + input.description : ''}`;
    case 'AskUserQuestion': return 'Waiting on your answer';
    default: return name;
  }
}

export interface Activity {
  action: string | null;
  at: string | null;
  plan: PlanItem[] | null;
}

/** Tail a transcript for the latest tool action and latest plan checklist. */
export async function readActivity(tp: string | null): Promise<Activity> {
  if (!tp) return { action: null, at: null, plan: null };
  let text: string;
  try { text = await readTail(tp); } catch { return { action: null, at: null, plan: null }; }
  const lines = text.split('\n');
  let action: string | null = null;
  let at: string | null = null;
  let plan: PlanItem[] | null = null;
  for (let i = lines.length - 1; i >= 0 && !(action && plan); i--) {
    let o: any;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o?.type !== 'assistant' || !Array.isArray(o?.message?.content)) continue;
    for (let j = o.message.content.length - 1; j >= 0; j--) {
      const b = o.message.content[j];
      if (!b || b.type !== 'tool_use') continue;
      if (!action) { action = summarizeTool(b.name, b.input); at = o.timestamp ?? null; }
      if (!plan && b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
        plan = b.input.todos.map((t: any) => ({ content: t.content || t.activeForm || '', status: t.status || 'pending' }));
      }
    }
  }
  return { action, at, plan };
}

/** Read the cwd recorded in a transcript (first entry carrying one). */
export async function transcriptCwd(tp: string | null): Promise<string | null> {
  if (!tp) return null;
  try {
    for (const line of (await readHead(tp, 16384)).split('\n')) {
      try { const o = JSON.parse(line); if (o?.cwd) return o.cwd as string; } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return null;
}
