// Read-only replay of a session's transcript, normalized into ChatItem[].
//
// Uses the SDK's getSessionMessages / getSubagentMessages (the official,
// format-robust readers) rather than parsing JSONL by hand — same firewall
// principle as the rest of the adapter. Both work against sessions FleetView
// does not own, including ones that are live at read time.
import { getSessionMessages, getSubagentMessages } from '@anthropic-ai/claude-agent-sdk';
import { summarizeTool } from './transcripts';
import type { ChatItem } from '../types';

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
}

const TASK_NOTIFICATION_RE = /<task-notification[\s\S]*?<\/task-notification>/g;
const SYSTEM_REMINDER_RE = /<system-reminder[\s\S]*?<\/system-reminder>/g;
const SYSTEM_NOTIFICATION_RE = /\[SYSTEM NOTIFICATION[^\]]*\]\n(?:.*\n){0,3}/g;

function extractNotifications(text: string): { clean: string; notifications: string[] } {
  const notifications: string[] = [];
  let clean = text;
  clean = clean.replace(TASK_NOTIFICATION_RE, (match) => {
    const summaryMatch = match.match(/<summary>([\s\S]*?)<\/summary>/);
    if (summaryMatch) notifications.push(summaryMatch[1].trim());
    return '';
  });
  clean = clean.replace(SYSTEM_REMINDER_RE, '');
  clean = clean.replace(SYSTEM_NOTIFICATION_RE, '');
  return { clean: clean.trim(), notifications };
}

type SessionMessage = Awaited<ReturnType<typeof getSessionMessages>>[number];

function normalize(msgs: SessionMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const m of msgs) {
    const msg = m.message as { role?: string; content?: unknown } | undefined;
    if (!msg) continue;
    const at = (m as unknown as { timestamp?: string }).timestamp || undefined;
    if (m.type === 'user') {
      // Skip tool_result-only user messages — those are tool plumbing, not prompts.
      const c = msg.content;
      const isToolResult = Array.isArray(c) && c.every((b: any) => b?.type === 'tool_result');
      if (isToolResult) continue;
      const text = textOf(c);
      if (!text.trim()) continue;
      const { clean, notifications } = extractNotifications(text);
      for (const n of notifications) {
        items.push({ kind: 'notification', text: n, at });
      }
      if (clean) items.push({ kind: 'user', text: clean, at });
    } else if (m.type === 'assistant') {
      const c = Array.isArray(msg.content) ? msg.content : [];
      const text = textOf(c);
      if (text.trim()) items.push({ kind: 'assistant', text, at });
      for (const b of c as any[]) {
        // summarizeTool prefers Bash's own `description` over the raw command —
        // the human-readable text the model already wrote. v1 had a second, worse
        // copy of this here that made `description` unreachable (FUTURE.md).
        if (b?.type === 'tool_use') {
          if (b.name === 'Write' && typeof b.input?.file_path === 'string' && b.input.file_path.includes('/.claude/plans/') && b.input.content) {
            items.push({ kind: 'plan', text: b.input.content, path: b.input.file_path, at });
          }
          items.push({ kind: 'tool', name: b.name ?? 'tool', summary: summarizeTool(b.name, b.input), at });
        }
      }
    }
  }
  return items;
}

/** Full transcript for a session, live or past. Never throws. */
export async function readSessionHistory(sessionId: string): Promise<ChatItem[]> {
  try { return normalize(await getSessionMessages(sessionId)); } catch { return []; }
}

/** Transcript for one subagent within a session — the read-only teammate page. */
export async function readSubagentHistory(sessionId: string, agentId: string): Promise<ChatItem[]> {
  try { return normalize(await getSubagentMessages(sessionId, agentId)); } catch { return []; }
}
