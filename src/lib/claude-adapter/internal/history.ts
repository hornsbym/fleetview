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

type SessionMessage = Awaited<ReturnType<typeof getSessionMessages>>[number];

function normalize(msgs: SessionMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const m of msgs) {
    const msg = m.message as { role?: string; content?: unknown } | undefined;
    if (!msg) continue;
    if (m.type === 'user') {
      // Skip tool_result-only user messages — those are tool plumbing, not prompts.
      const c = msg.content;
      const isToolResult = Array.isArray(c) && c.every((b: any) => b?.type === 'tool_result');
      if (isToolResult) continue;
      const text = textOf(c);
      if (text.trim()) items.push({ kind: 'user', text });
    } else if (m.type === 'assistant') {
      const c = Array.isArray(msg.content) ? msg.content : [];
      const text = textOf(c);
      if (text.trim()) items.push({ kind: 'assistant', text });
      for (const b of c as any[]) {
        // summarizeTool prefers Bash's own `description` over the raw command —
        // the human-readable text the model already wrote. v1 had a second, worse
        // copy of this here that made `description` unreachable (FUTURE.md).
        if (b?.type === 'tool_use') {
          items.push({ kind: 'tool', name: b.name ?? 'tool', summary: summarizeTool(b.name, b.input) });
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
