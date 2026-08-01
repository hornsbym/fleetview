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
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { summarizeTool } from './transcripts';
import type { AgentReport, Milestone, PlanItem, SessionDigest, SummaryAnchor, SummaryBullet, TrailItem } from '../types';

/** How many recent tool calls to keep for the activity trail. */
const TRAIL_MAX = 8;
/** Cap on retained milestones — newest win; a long session shouldn't grow forever. */
const DONE_MAX = 60;

interface Cursor {
  offset: number;          // byte offset of the next unparsed line
  /** tool_use ids that have received a tool_result — i.e. that call has returned. */
  toolResults: Set<string>;
  /** Agent tool_use ids pending completion, mapped to their description. */
  pendingAgents: Map<string, string>;
  trail: TrailItem[];      // newest last
  done: Milestone[];       // newest last
  compactions: number;
  edits: number;
  tools: number;
  lastUser: string | null;
  /** Where each summary bullet first appeared, keyed by normalized title. */
  summaryAnchors: Map<string, SummaryAnchor>;
  /** Anchors still waiting for the prose message that confirms their work.
   *  Held by reference, so filling `confirmedBy` in updates the stored anchor. */
  pendingConfirm: SummaryAnchor[];
  /** Tasks created via TaskCreate, keyed by id. */
  tasks: Map<string, { subject: string; status: string }>;
  taskNextId: number;
  /** Latest TodoWrite snapshot (overrides tasks if present). */
  todoWrite: PlanItem[] | null;
}

const cursors = new Map<string, Cursor>();

const fresh = (): Cursor => ({
  offset: 0, toolResults: new Set(), pendingAgents: new Map(), trail: [], done: [], compactions: 0, edits: 0, tools: 0, lastUser: null,
  summaryAnchors: new Map(), pendingConfirm: [],
  tasks: new Map(), taskNextId: 1, todoWrite: null,
});

/** The report an agent maintains about itself, by path shape. Matching any
 *  session file rather than this session's specific id is deliberate: a session
 *  only ever writes its own, and the scan doesn't otherwise need to know the id. */
const REPORT_PATH = /\.fleetview[/\\]sessions[/\\][^/\\]+\.json$/;

/** Join key for matching a bullet in the current report against one seen in an
 *  earlier write. Titles are prose the agent retypes each time, so tolerate
 *  whitespace and trailing-punctuation drift — but nothing more. A looser match
 *  would confidently link a bullet to the wrong part of the conversation, which
 *  is worse than showing no link at all. */
const titleKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

/**
 * Record where each summary bullet first showed up.
 *
 * The agent can't report this itself — it never sees its own transcript ids. But
 * it rewrites the whole report file on every update, and those writes are in the
 * transcript with their full content, so the first write whose `summary` contains
 * a bullet is the moment that bullet came into existence. First write wins: later
 * writes repeat the same bullets, and it's the *first* claim that sits next to the
 * work.
 */
function anchorSummary(c: Cursor, block: any, at: string | null) {
  if (block.name !== 'Write' || !REPORT_PATH.test(String(block.input?.file_path ?? ''))) return;
  let raw: unknown;
  try { raw = JSON.parse(String(block.input?.content ?? '')); } catch { return; }
  for (const b of summaryBullets((raw as any)?.summary)) {
    const key = titleKey(b.title);
    if (!key || c.summaryAnchors.has(key)) continue;
    const anchor: SummaryAnchor = { reportedBy: String(block.id ?? ''), confirmedBy: null, at };
    c.summaryAnchors.set(key, anchor);
    c.pendingConfirm.push(anchor);
  }
}

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
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          c.toolResults.add(b.tool_use_id);
          const desc = c.pendingAgents.get(b.tool_use_id);
          if (desc) {
            c.pendingAgents.delete(b.tool_use_id);
            pushDone(c, { kind: 'subagent', text: desc, at: o.timestamp ?? null });
          }
        }
      }
    }
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
        : '';
    const trimmed = text.trim();
    // Skip tool plumbing and system-injected reminders; keep real prompts.
    //
    // `isMeta` is the second half of that rule and was missing: a loaded skill
    // body and the harness's injected instruction blocks arrive as ordinary
    // `type: 'user'` text that doesn't start with '<', so they were being taken
    // for the user's own request. That shows up directly in the UI — with no
    // self-reported goal, NowPanel renders `lastRequest` as "Working toward",
    // and a session that ran /fleetview claimed to be working toward the skill's
    // own documentation.
    if (trimmed && !trimmed.startsWith('<') && o.isMeta !== true) {
      c.lastUser = trimmed.slice(0, 200);
    }
    return;
  }

  if (o?.type !== 'assistant' || !Array.isArray(o?.message?.content)) return;

  // Claim any anchors waiting on a confirmation with this message, BEFORE the
  // tool_use loop below can add more. Order is what keeps a preamble out of it:
  // text in the same message as the report write ran before the work finished,
  // so only a later message can be the confirmation.
  //
  // Sidechain entries are subagent traffic that the session transcript doesn't
  // render, so they can never be a jump target.
  if (c.pendingConfirm.length && o.isSidechain !== true && typeof o.uuid === 'string') {
    const prose = o.message.content.some((b: any) => b?.type === 'text' && String(b.text ?? '').trim());
    if (prose) {
      for (const a of c.pendingConfirm) a.confirmedBy = o.uuid;
      c.pendingConfirm = [];
    }
  }

  for (const b of o.message.content) {
    if (!b || b.type !== 'tool_use') continue;
    c.tools++;

    const summary = summarizeTool(b.name, b.input);
    c.trail.push({ name: b.name, summary, at: o.timestamp ?? null });
    if (c.trail.length > TRAIL_MAX) c.trail.shift();

    if (b.name === 'Write' || b.name === 'Edit' || b.name === 'NotebookEdit') c.edits++;

    anchorSummary(c, b, o.timestamp ?? null);

    if (b.name === 'Agent' && b.id) {
      const desc = b.input?.description || b.input?.prompt?.slice(0, 80) || 'subagent';
      c.pendingAgents.set(b.id, desc);
    }

    if (b.name === 'Bash') {
      const subject = commitSubject(String(b.input?.command ?? ''));
      if (subject) pushDone(c, { kind: 'commit', text: subject, at: o.timestamp ?? null });
    }

    if (b.name === 'ExitPlanMode') {
      pushDone(c, { kind: 'plan', text: 'Plan approved', at: o.timestamp ?? null });
    }

    // The harness task tools are the model's own statement of completion.
    if (b.name === 'TaskCreate' && b.input?.subject) {
      const id = String(c.taskNextId++);
      c.tasks.set(id, { subject: b.input.subject, status: 'pending' });
    }
    if (b.name === 'TaskUpdate' && b.input?.taskId) {
      const t = c.tasks.get(b.input.taskId);
      if (t && b.input.status) t.status = b.input.status;
      if (b.input.status === 'completed') {
        pushDone(c, { kind: 'task', text: t?.subject || `Task #${b.input.taskId} completed`, at: o.timestamp ?? null });
      }
    }
    if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
      c.todoWrite = b.input.todos.map((t: any) => ({ content: t.content || t.activeForm || '', status: t.status || 'pending' }));
      for (const t of b.input.todos) {
        if (t?.status === 'completed' && t?.content) {
          pushDone(c, { kind: 'task', text: String(t.content), at: o.timestamp ?? null });
        }
      }
    }
  }
}

/**
 * The agent's own account of what it's doing and what it has finished.
 *
 * Extends the existing `.fleetview/plan.json` self-report convention to the
 * session level. The agent writes `<cwd>/.fleetview/sessions/<sessionId>.json`,
 * where the id comes from `CLAUDE_CODE_SESSION_ID` — verified to be exported to
 * every session and to track the *current* id (it follows a `/clear` fork).
 *
 * When present this is authoritative: a sentence the agent wrote about its own
 * intent beats anything inferred from which tool happened to run last. Same
 * precedence rule `plan.json`'s `phase` already has over harness-derived state.
 */
async function readReport(cwd: string | null, sessionId: string): Promise<AgentReport | null> {
  if (!cwd || !sessionId) return null;
  const p = path.join(cwd, '.fleetview', 'sessions', `${sessionId}.json`);
  try {
    const raw = JSON.parse(await readFile(p, 'utf8'));
    const done = Array.isArray(raw?.done)
      ? raw.done.filter((d: unknown) => typeof d === 'string' && d.trim()).map((d: string) => d.trim())
      : [];
    const now = typeof raw?.now === 'string' ? raw.now.trim() : '';
    const goal = typeof raw?.goal === 'string' ? raw.goal.trim() : '';
    const summary = summaryBullets(raw?.summary);
    if (!now && !done.length && !summary.length && !goal) return null;
    return { now: now || null, goal: goal || null, summary: summary.length ? summary : null, done, updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null };
  } catch {
    return null;
  }
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Split prose on sentence boundaries. The lookbehind requires a lowercase
 *  letter or digit before the stop, which keeps "e.g." and "v1.2" intact; the
 *  lookahead requires a capital, so a split only happens where a new sentence
 *  plausibly starts. */
const sentences = (text: string) =>
  text.split(/(?<=[a-z0-9][.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);

/**
 * Normalize `summary` into {title, description} bullets.
 *
 * Three shapes reach this, and all three have to render: the objects the skill
 * asks for, bare strings (the shape the skill asked for previously), and one
 * prose blob (the shape before that, and what an agent still produces when it
 * paraphrases the instruction). Strings become title-only bullets — a sentence
 * promoted to a title is honest, whereas inventing a title from its first few
 * words is not. Prose is split so a paragraph isn't one dense bullet.
 */
function summaryBullets(raw: unknown): SummaryBullet[] {
  const bullet = (v: unknown): SummaryBullet | null => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const description = clean(o.description);
      // Description-only is malformed but recoverable: it's still the one piece
      // of text the agent wrote, so show it rather than dropping the bullet.
      const title = clean(o.title) || description;
      if (!title) return null;
      return { title, description: title === description ? '' : description };
    }
    const text = clean(v);
    return text ? { title: text, description: '' } : null;
  };

  if (Array.isArray(raw)) return raw.map(bullet).filter((b): b is SummaryBullet => b !== null);
  const text = clean(raw);
  if (!text) return [];
  return sentences(text).map(s => ({ title: s, description: '' }));
}

/** Conceptual description of recent activity derived from the tool trail.
 *  Aims for sentences like "Investigating route handler in main.ts" or
 *  "Waiting for report back from code-reviewer agent" rather than generic
 *  "editing files" or tool names. */
function describeActivity(trail: TrailItem[]): string | null {
  if (!trail.length) return null;

  // Most recent tool call is the best signal for "what it's doing right now".
  const latest = trail[trail.length - 1];
  const desc = describeOne(latest);
  if (desc) return desc;

  // If the latest didn't produce a good sentence, try the second-most-recent.
  if (trail.length > 1) {
    const prev = describeOne(trail[trail.length - 2]);
    if (prev) return prev;
  }

  return null;
}

function describeOne(item: TrailItem): string | null {
  const name = item.name;
  const summary = item.summary;

  if (name === 'Agent' || name === 'Task') {
    // summary looks like "Spawn code-reviewer: Review the auth middleware"
    const m = summary.match(/^Spawn\s+(\S+?)(?::\s*(.+))?$/);
    if (m) {
      const agentType = m[1];
      const task = m[2];
      if (task) return `Delegating to ${agentType} agent — ${task}`;
      return `Waiting for report back from ${agentType} agent`;
    }
    return 'Coordinating subagents';
  }

  if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
    // summary looks like "Edit App.tsx" or "Write store.ts"
    const file = summary.replace(/^(Edit|Write|NotebookEdit)\s*/, '');
    if (file) return `Writing code in ${file}`;
    return 'Writing code';
  }

  if (name === 'Read') {
    const file = summary.replace(/^Read\s*/, '');
    if (file) return `Investigating ${file}`;
    return 'Reading through the codebase';
  }

  if (name === 'Grep') {
    const pattern = summary.replace(/^Grep\s*/, '');
    if (pattern) return `Searching for "${pattern}"`;
    return 'Searching the codebase';
  }

  if (name === 'Glob') {
    const pattern = summary.replace(/^Glob\s*/, '');
    if (pattern) return `Looking for files matching ${pattern}`;
    return 'Scanning file structure';
  }

  if (name === 'Bash') {
    // summary looks like "Bash: description" or "Bash: raw command"
    const cmd = summary.replace(/^Bash:\s*/, '');
    if (!cmd) return 'Executing a command';
    // If the tool had a human-written description, use it directly.
    // Heuristic: descriptions are sentence-like (start with uppercase or a verb),
    // while raw commands start with lowercase or special chars.
    if (/^[A-Z]/.test(cmd) && !cmd.startsWith('/')) return cmd;
    // Try to extract intent from common command patterns
    if (/\b(test|jest|vitest|mocha|pytest)\b/i.test(cmd)) return 'Running tests';
    if (/\btsc\b|type.?check/i.test(cmd)) return 'Type-checking the project';
    if (/\b(build|compile|vite build|webpack)\b/i.test(cmd)) return 'Building the project';
    if (/\bgit\s+(status|diff|log)\b/.test(cmd)) return 'Checking git state';
    if (/\bgit\s+commit\b/.test(cmd)) return 'Committing changes';
    if (/\b(curl|fetch|wget)\b/.test(cmd)) return 'Making an HTTP request';
    if (/\b(npm|pnpm|yarn)\s+(install|add)\b/.test(cmd)) return 'Installing dependencies';
    if (/\bdev\b|server/i.test(cmd)) return 'Starting a dev server';
    return `Executing: ${cmd.slice(0, 60)}`;
  }

  if (name === 'AskUserQuestion') {
    return 'Waiting for your answer';
  }

  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    const server = parts[1] || 'external';
    return `Working with ${server}`;
  }

  return null;
}

/**
 * Read (or incrementally update) a session's digest.
 *
 * Never throws — an unreadable or unparseable transcript yields an empty digest,
 * matching the rest of the adapter's defensive posture.
 */
/**
 * Advance the incremental cursor for a transcript and return it.
 * Shared by the digest and by subagent-completion lookups so one pass serves both.
 */
async function scan(transcriptPath: string): Promise<Cursor | null> {
  let size = 0;
  try { ({ size } = await stat(transcriptPath)); } catch { return null; }

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
  return c;
}

/**
 * Which spawned agents have RETURNED, by the `toolUseId` in their meta.json.
 *
 * This is the definitive "is it still running" signal, and it replaces guessing
 * from transcript staleness — a quiet agent may simply be idle or waiting, which
 * is not the same as finished. A subagent's spawning `Agent`/`Task` tool_use gets
 * a matching `tool_result` in the PARENT transcript the moment it returns (or is
 * dismissed), so presence of that id means done and absence means still alive.
 */
export async function completedToolUses(transcriptPath: string | null): Promise<Set<string>> {
  if (!transcriptPath) return new Set();
  const c = await scan(transcriptPath);
  return c ? c.toolResults : new Set();
}

export async function readDigest(
  transcriptPath: string | null,
  opts: { cwd?: string | null; sessionId?: string } = {},
): Promise<SessionDigest> {
  const report = await readReport(opts.cwd ?? null, opts.sessionId ?? '');
  const empty: SessionDigest = {
    now: report?.now ?? null,
    summary: report?.summary ?? null,
    reported: !!report,
    reportedAt: report?.updatedAt ?? null,
    doing: null, trail: [],
    done: (report?.done ?? []).map(text => ({ kind: 'reported' as const, text, at: null })),
    compactions: 0, edits: 0, tools: 0, goal: report?.goal ?? null, lastRequest: null, tasks: [],
  };
  if (!transcriptPath) return empty;
  const c = await scan(transcriptPath);
  if (!c) return empty;

  const trail = [...c.trail].reverse();       // newest first
  const derived = [...c.done].reverse();      // newest first

  // The report file is the source of the bullets; the transcript scan is the
  // source of where they came from. Join here rather than in readReport, which
  // has no view of the transcript.
  const summary = report?.summary
    ? report.summary.map(b => ({ ...b, anchor: c.summaryAnchors.get(titleKey(b.title)) ?? null }))
    : null;

  return {
    // The agent's own sentence wins; otherwise say what it's conceptually doing
    // rather than naming the tool — a command string is not an explanation.
    now: report?.now ?? describeActivity(trail),
    summary,
    reported: !!report,
    reportedAt: report?.updatedAt ?? null,
    doing: trail[0] ?? null,
    trail,
    // Agent-maintained list is authoritative; derived milestones are the fallback
    // so a session that never adopts the convention still shows something real.
    done: report?.done.length
      ? report.done.map(text => ({ kind: 'reported' as const, text, at: null }))
      : derived,
    compactions: c.compactions,
    edits: c.edits,
    tools: c.tools,
    goal: report?.goal ?? null,
    lastRequest: c.lastUser,
    tasks: buildTasks(c),
  };
}

function buildTasks(c: Cursor): import('../types').Task[] {
  if (c.todoWrite) {
    return c.todoWrite.map((t, i) => ({
      id: String(i + 1),
      subject: t.content,
      status: t.status === 'completed' ? 'completed' as const : t.status === 'in_progress' ? 'in_progress' as const : 'pending' as const,
    }));
  }
  if (c.tasks.size > 0) {
    return [...c.tasks.entries()].map(([id, t]) => ({
      id,
      subject: t.subject,
      status: t.status === 'completed' ? 'completed' as const : t.status === 'in_progress' ? 'in_progress' as const : 'pending' as const,
    }));
  }
  return [];
}
