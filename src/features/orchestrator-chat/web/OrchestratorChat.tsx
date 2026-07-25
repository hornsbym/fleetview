// The chat panel that drives one repo's orchestrator: Start/Stop lifecycle, an SSE
// transcript (assistant text + tool lines + result markers), and a message box.
// Servers report; this UI decides how to render — it reads { ok, status } and the
// event stream and owns all presentation.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OkResponse, OrchestratorEvent, OrchestratorStatus, StatusResponse } from '../shared/events';
import './OrchestratorChat.css';
import { linkify } from '../../../ui/FileLink';

export interface OrchestratorChatProps {
  /** Absolute repo path whose orchestrator this panel controls. */
  repo: string;
}

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; done: boolean }
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'result'; costUsd?: number; tokens?: number }
  | { kind: 'system'; text: string };

/** Compact one-liner for a tool call's input (Bash command, file path, etc.). */
function toolSummary(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.description ?? i.prompt;
  if (typeof pick === 'string') return pick;
  try {
    const s = JSON.stringify(i);
    return s && s !== '{}' ? s : '';
  } catch {
    return '';
  }
}

/** Fold one stream event into the transcript. Consecutive assistant text within a
    turn accumulates into one bubble; `result` closes it and drops a turn marker. */
function applyEvent(items: Item[], e: OrchestratorEvent): Item[] {
  switch (e.kind) {
    case 'assistant': {
      if (!e.text) return items;
      const last = items[items.length - 1];
      if (last?.kind === 'assistant' && !last.done) {
        return [...items.slice(0, -1), { ...last, text: last.text + e.text }];
      }
      return [...items, { kind: 'assistant', text: e.text, done: false }];
    }
    case 'tool_use':
      return [
        ...items,
        { kind: 'tool', name: e.tool?.name ?? 'tool', summary: e.tool ? toolSummary(e.tool.input) : '' },
      ];
    case 'result': {
      const closed = items.map((it, idx) =>
        idx === items.length - 1 && it.kind === 'assistant' ? { ...it, done: true } : it,
      );
      return [...closed, { kind: 'result', costUsd: e.costUsd, tokens: e.tokens }];
    }
    case 'init':
      return [...items, { kind: 'system', text: `Session started${e.sessionId ? ` · ${e.sessionId}` : ''}` }];
    case 'permission':
      return [...items, { kind: 'system', text: `Permission requested: ${e.permission?.toolName ?? 'tool'}` }];
    case 'error':
      return [...items, { kind: 'system', text: `Error: ${e.text ?? 'unknown'}` }];
    case 'exit':
      return [...items, { kind: 'system', text: `Orchestrator exited${typeof e.code === 'number' ? ` (code ${e.code})` : ''}` }];
    default:
      return items; // internal 'system' noise (stderr, unmapped) — keep it out of the transcript
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function OrchestratorChat({ repo }: OrchestratorChatProps) {
  const [status, setStatus] = useState<OrchestratorStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset transcript + probe status whenever the selected repo changes.
  useEffect(() => {
    setItems([]);
    setSessionId(null);
    setStatus('idle');
    setNotice(null);
    if (!repo) return;
    let alive = true;
    (async () => {
      try {
        const d: StatusResponse = await (
          await fetch(`/api/orchestrator/status?repo=${encodeURIComponent(repo)}`)
        ).json();
        if (alive && d.ok) {
          setStatus(d.status ?? 'idle');
          setSessionId(d.sessionId ?? null);
        }
      } catch {
        /* leave idle; Start still works */
      }
    })();
    return () => {
      alive = false;
    };
  }, [repo]);

  // Live SSE stream for the selected repo (reconnects on repo change/unmount).
  useEffect(() => {
    if (!repo) return;
    const es = new EventSource(`/api/orchestrator/stream?repo=${encodeURIComponent(repo)}`);
    es.onmessage = (ev) => {
      let e: OrchestratorEvent;
      try {
        e = JSON.parse(ev.data);
      } catch {
        return;
      }
      setItems((prev) => applyEvent(prev, e));
      if (e.kind === 'init') {
        setStatus('running');
        if (e.sessionId) setSessionId(e.sessionId);
      } else if (e.kind === 'exit') setStatus('stopped');
      else if (e.kind === 'error') setStatus('error');
    };
    es.onerror = () => {
      /* EventSource auto-reconnects; Last-Event-ID resumes without re-replay */
    };
    return () => es.close();
  }, [repo]);

  // Auto-scroll to the latest line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const start = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const d = await postJson<StatusResponse>('/api/orchestrator/start', { repo });
      if (d.ok) {
        setStatus(d.status ?? 'running');
        setSessionId(d.sessionId ?? null);
      } else setNotice('Could not start the orchestrator.');
    } catch {
      setNotice('Could not start the orchestrator.');
    } finally {
      setBusy(false);
    }
  }, [repo]);

  const stop = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      await postJson<OkResponse>('/api/orchestrator/stop', { repo });
      setStatus('stopped');
    } catch {
      setNotice('Could not stop the orchestrator.');
    } finally {
      setBusy(false);
    }
  }, [repo]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || status !== 'running') return;
    setInput('');
    setItems((prev) => [...prev, { kind: 'user', text }]);
    try {
      const d = await postJson<OkResponse>('/api/orchestrator/message', { repo, text });
      if (!d.ok) setItems((prev) => [...prev, { kind: 'system', text: 'Message failed to send.' }]);
    } catch {
      setItems((prev) => [...prev, { kind: 'system', text: 'Message failed to send.' }]);
    }
  }, [input, repo, status]);

  const running = status === 'running';

  return (
    <div className="oc">
      <div className="oc-bar">
        <span className={`oc-status oc-${status}`}>
          {running && <span className="oc-dot" />}
          {status}
        </span>
        {running && sessionId && (
          <span className="oc-sid mono" title={sessionId}>
            {sessionId}
          </span>
        )}
        <span className="oc-spacer" />
        {running ? (
          <button type="button" className="oc-btn" disabled={busy} onClick={() => void stop()}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="oc-btn oc-primary"
            disabled={busy || !repo}
            onClick={() => void start()}
          >
            Start
          </button>
        )}
      </div>

      <div className="oc-transcript" ref={scrollRef}>
        {items.length === 0 ? (
          <div className="oc-hint">{running ? 'Say hello to the orchestrator.' : 'Start an orchestrator to chat.'}</div>
        ) : (
          items.map((it, i) => <TranscriptItem key={i} item={it} repo={repo} />)
        )}
      </div>

      {notice && <div className="oc-notice">{notice}</div>}

      <form
        className="oc-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="oc-textarea"
          rows={2}
          aria-label="Message the orchestrator"
          placeholder={running ? 'Message the orchestrator…' : 'Start an orchestrator to chat'}
          value={input}
          disabled={!running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="oc-btn oc-primary" disabled={!running || input.trim() === ''}>
          Send
        </button>
      </form>
    </div>
  );
}

function TranscriptItem({ item, repo }: { item: Item; repo: string }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="oc-msg oc-user">
          <div className="oc-bubble">{linkify(item.text, repo)}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="oc-msg oc-assistant">
          <div className="oc-bubble">
            {linkify(item.text, repo)}
            {!item.done && <span className="oc-caret" />}
          </div>
        </div>
      );
    case 'tool':
      return (
        <div className="oc-tool">
          ⚙ {item.name}
          {item.summary && <span className="oc-tool-arg mono">: {linkify(item.summary, repo)}</span>}
        </div>
      );
    case 'result': {
      const bits = [
        item.costUsd != null ? `$${item.costUsd.toFixed(3)}` : null,
        item.tokens != null ? `${item.tokens.toLocaleString()} tok` : null,
      ].filter(Boolean);
      return <div className="oc-result">✓ done{bits.length ? ` · ${bits.join(' · ')}` : ''}</div>;
    }
    case 'system':
      return <div className="oc-system">{item.text}</div>;
  }
}
