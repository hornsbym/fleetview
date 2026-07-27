// Per-session digest: "what is this agent doing right now" and "what has it
// actually finished". Both are derived from the session transcript.
//
// Why the transcript and not the model's context: **compaction does not delete
// history from the JSONL**. Verified against a real compacted session — 18.6 MB,
// 8 `compact_boundary` entries, 949 entries still present before the first one.
// Compaction shrinks what the model can see; the file keeps everything. So a
// digest derived from the file survives compaction by construction, with no
// separate persistence layer.
//
// The cost of that is having to read the whole file rather than a tail, which is
// far too expensive at poll frequency. So this scans INCREMENTALLY: each session
// keeps a byte cursor and only parses what has been appended since last time.
// (Claude Code does the same thing for its own job tracking — see the
// `linkScanOffset` field in ~/.claude/jobs/<id>/state.json.)
import { open, stat } from 'node:fs/promises';
import { summarizeTool } from './transcripts';
import type { Milestone, SessionDigest, TrailItem } from '../types';

/** How many recent tool calls to keep for the activity trail. */
const TRAIL_MAX = 8;
/** Cap on retained milestones — newest win; a long session shouldn't grow forever. */
const DONE_MAX = 60;

interface Cursor {
  offset: number;          // byte offset of the next unparsed line
  trail: TrailItem[];      // newest last
  done: Milestone[];       // newest last
  compactions: number;
  edits: number;
  tools: number;
  lastUser: string | null;
}

const cursors = new Map<string, Cursor>();

const fresh = (): Cursor => ({
  offset: 0, trail: [], done: [], compactions: 0, edits: 0, tools: 0, lastUser: null,
});

/**
 * Pull a commit subject out of a `git commit` invocation.
 * Handles `-m "subject"`, `-m 'subject'`, and the heredoc form this repo uses
 * (`git commit -F - <<'EOF'` … ), where the subject is the first non-empty line.
 */
function commitSubject(cmd: string): string | null {
  // `git commit` must appear in COMMAND position — start of the string or after a
  // shell separator. Matching it anywhere produced false positives from scripts
  // that merely mention it: a `python3 - <<'PY'` block containing the literal
  // "git commit" was reported as a commit titled "import json".
  const GIT_COMMIT = /(?:^|[\n;&|(]|&&|\|\|)\s*git\s+(?:-\S+\s+)*commit\b([^\n]*)/;
  const m = GIT_COMMIT.exec(cmd);
  if (!m) return null;
  const flags = m[1];

  const inline = flags.match(/-m\s+(["'])([\s\S]*?)\1/);
  if (inline) return inline[2].split('\n')[0].trim() || null;

  // Heredoc form (`git commit -F - <<'EOF'`). Only trust the heredoc when the
  // commit actually reads its message from stdin, otherwise any nearby heredoc
  // would be mistaken for the message.
  if (/-F\s*-/.test(flags)) {
    const here = cmd.match(/<<\s*'?(\w+)'?\s*\n([\s\S]*?)\n\1/);
    const first = here?.[2].split('\n').map(l => l.trim()).find(Boolean);
    if (first) return first;
  }
  return null;
}

function pushDone(c: Cursor, item: Milestone) {
  // Same milestone can be re-observed if a file is re-scanned from scratch.
  if (c.done.some(d => d.kind === item.kind && d.text === item.text)) return;
  c.done.push(item);
  if (c.done.length > DONE_MAX) c.done.shift();
}

function ingest(c: Cursor, line: string) {
  let o: any;
  try { o = JSON.parse(line); } catch { return; }

  if (o?.type === 'system' && o?.subtype === 'compact_boundary') {
    c.compactions++;
    pushDone(c, {
      kind: 'compaction',
      text: `Context compacted${o?.compactMetadata?.trigger ? ` (${o.compactMetadata.trigger})` : ''}`,
      at: o?.timestamp ?? null,
    });
    return;
  }

  if (o?.type === 'user') {
    const content = o?.message?.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
        : '';
    const trimmed = text.trim();
    // Skip tool plumbing and system-injected reminders; keep real prompts.
    if (trimmed && !trimmed.startsWith('<')) c.lastUser = trimmed.slice(0, 200);
    return;
  }

  if (o?.type !== 'assistant' || !Array.isArray(o?.message?.content)) return;

  for (const b of o.message.content) {
    if (!b || b.type !== 'tool_use') continue;
    c.tools++;

    const summary = summarizeTool(b.name, b.input);
    c.trail.push({ name: b.name, summary, at: o.timestamp ?? null });
    if (c.trail.length > TRAIL_MAX) c.trail.shift();

    if (b.name === 'Write' || b.name === 'Edit' || b.name === 'NotebookEdit') c.edits++;

    if (b.name === 'Bash') {
      const subject = commitSubject(String(b.input?.command ?? ''));
      if (subject) pushDone(c, { kind: 'commit', text: subject, at: o.timestamp ?? null });
    }

    if (b.name === 'ExitPlanMode') {
      pushDone(c, { kind: 'plan', text: 'Plan approved', at: o.timestamp ?? null });
    }

    // The harness task tools are the model's own statement of completion.
    if (b.name === 'TaskUpdate' && b.input?.status === 'completed') {
      pushDone(c, { kind: 'task', text: `Task #${b.input.taskId} completed`, at: o.timestamp ?? null });
    }
    if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
      for (const t of b.input.todos) {
        if (t?.status === 'completed' && t?.content) {
          pushDone(c, { kind: 'task', text: String(t.content), at: o.timestamp ?? null });
        }
      }
    }
  }
}

/**
 * Read (or incrementally update) a session's digest.
 *
 * Never throws — an unreadable or unparseable transcript yields an empty digest,
 * matching the rest of the adapter's defensive posture.
 */
export async function readDigest(transcriptPath: string | null): Promise<SessionDigest> {
  const empty: SessionDigest = {
    doing: null, trail: [], done: [], compactions: 0, edits: 0, tools: 0, lastRequest: null,
  };
  if (!transcriptPath) return empty;

  let size = 0;
  try { ({ size } = await stat(transcriptPath)); } catch { return empty; }

  let c = cursors.get(transcriptPath);
  // A shrunk file means it was replaced (or forked over) — rescan from scratch.
  if (!c || size < c.offset) cursors.set(transcriptPath, c = fresh());

  if (size > c.offset) {
    const fh = await open(transcriptPath, 'r').catch(() => null);
    if (fh) {
      try {
        const len = size - c.offset;
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, c.offset);
        const chunk = buf.subarray(0, bytesRead);
        // Only consume up to the last complete line; a partial trailing line is
        // left for the next pass rather than parsed as garbage.
        const lastNl = chunk.lastIndexOf(0x0a);
        if (lastNl >= 0) {
          for (const line of chunk.subarray(0, lastNl).toString('utf8').split('\n')) {
            if (line) ingest(c, line);
          }
          c.offset += lastNl + 1;
        }
      } finally { await fh.close(); }
    }
  }

  const trail = [...c.trail].reverse();       // newest first
  return {
    doing: trail[0] ?? null,
    trail,
    done: [...c.done].reverse(),              // newest first
    compactions: c.compactions,
    edits: c.edits,
    tools: c.tools,
    lastRequest: c.lastUser,
  };
}
