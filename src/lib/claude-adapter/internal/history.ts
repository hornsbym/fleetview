// Read-only replay of a past session's transcript, normalized into ChatItem[] so a
// dead session's page can show its prior conversation before you Resume it. Uses the
// SDK's getSessionMessages (the official, format-robust reader) rather than parsing
// JSONL by hand — same firewall principle as the rest of the adapter.
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import type { ChatItem } from '../types';

/** Compact one-liner for a tool call's input (mirrors the live chat's toolSummary). */
function toolSummary(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.description ?? i.prompt;
  if (typeof pick === 'string') return pick;
  try { const s = JSON.stringify(i); return s && s !== '{}' ? s : ''; } catch { return ''; }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
}

export async function readOrchestratorHistory(_repo: string, sessionId: string): Promise<ChatItem[]> {
  let msgs: Awaited<ReturnType<typeof getSessionMessages>>;
  try { msgs = await getSessionMessages(sessionId); } catch { return []; }

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
        if (b?.type === 'tool_use') items.push({ kind: 'tool', name: b.name ?? 'tool', summary: toolSummary(b.input) });
      }
    }
  }
  return items;
}
