// One session's chat panel. It renders in two modes off a single (repo, sessionId):
//   • LIVE — this repo's owned orchestrator is running and its session matches (or
//     the "live" sentinel): full SSE transcript, message box, permission approvals.
//   • HISTORICAL — a past session: its transcript replayed read-only, with a Resume
//     button that continues it (which then flips this panel to live).
// Servers report ({ ok, status, pending, items }); this UI decides how to render.
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatItem, OrchestratorEvent, OrchestratorStatus, PermissionDecision, PermissionRequest, StatusResponse,
  OkResponse, HistoryResponse,
} from '../shared/events';
import './OrchestratorChat.css';
import { linkify } from '../../../ui/FileLink';
import { LIVE } from '../../../web/router';

export interface OrchestratorChatProps {
  repo: string;
  /** Route session id — a real session UUID, or the sentinel "live". */
  sessionId: string;
}

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; done: boolean }
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'result'; tokens?: number }
  | { kind: 'system'; text: string };

function toolSummary(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.description ?? i.prompt;
  if (typeof pick === 'string') return pick;
  try { const s = JSON.stringify(i); return s && s !== '{}' ? s : ''; } catch { return ''; }
}

/** Seed the transcript from a past session's normalized history (all closed). */
function fromHistory(items: ChatItem[]): Item[] {
  return items.map((it): Item =>
    it.kind === 'assistant' ? { kind: 'assistant', text: it.text, done: true } : it);
}

/** Fold one live stream event into the transcript (permissions handled separately). */
function applyEvent(items: Item[], e: OrchestratorEvent): Item[] {
  switch (e.kind) {
    case 'assistant': {
      if (!e.text) return items;
      const last = items[items.length - 1];
      if (last?.kind === 'assistant' && !last.done) return [...items.slice(0, -1), { ...last, text: last.text + e.text }];
      return [...items, { kind: 'assistant', text: e.text, done: false }];
    }
    case 'tool_use':
      return [...items, { kind: 'tool', name: e.tool?.name ?? 'tool', summary: e.tool ? toolSummary(e.tool.input) : '' }];
    case 'result': {
      const closed = items.map((it, idx) => (idx === items.length - 1 && it.kind === 'assistant' ? { ...it, done: true } : it));
      return [...closed, { kind: 'result', tokens: e.tokens }];
    }
    case 'init':
      return [...items, { kind: 'system', text: `Session started${e.sessionId ? ` · ${e.sessionId}` : ''}` }];
    case 'error':
      return [...items, { kind: 'system', text: `Error: ${e.text ?? 'unknown'}` }];
    case 'exit':
      return [...items, { kind: 'system', text: `Orchestrator exited${typeof e.code === 'number' ? ` (code ${e.code})` : ''}` }];
    default:
      return items;
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

export function OrchestratorChat({ repo, sessionId }: OrchestratorChatProps) {
  const [status, setStatus] = useState<OrchestratorStatus>('idle');
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Is the running orchestrator THIS page's session? "live" sentinel always matches
  // the owned session; a real id matches only when it's the one currently running.
  const isLive = status === 'running' && (sessionId === LIVE || liveSessionId === sessionId);
  const isHistorical = !isLive;

  // On (repo, sessionId) change: probe status, then seed history if this is a past
  // session. The SSE effect (below) rebuilds the transcript when it IS live.
  useEffect(() => {
    setItems([]); setPending([]); setNotice(null); setInput('');
    if (!repo) return;
    let alive = true;
    (async () => {
      let running = false; let sid: string | null = null;
      try {
        const d: StatusResponse = await (await fetch(`/api/orchestrator/status?repo=${encodeURIComponent(repo)}`)).json();
        if (!alive) return;
        if (d.ok) { setStatus(d.status ?? 'idle'); setLiveSessionId(d.sessionId ?? null); setPending(d.pending ?? []); running = d.status === 'running'; sid = d.sessionId ?? null; }
      } catch { /* stay idle */ }
      const live = running && (sessionId === LIVE || sid === sessionId);
      if (!live && sessionId !== LIVE) {
        try {
          const h: HistoryResponse = await (await fetch(`/api/orchestrator/history?repo=${encodeURIComponent(repo)}&sessionId=${encodeURIComponent(sessionId)}`)).json();
          if (alive && h.ok && h.items) setItems(fromHistory(h.items));
        } catch { /* no history — leave empty */ }
      }
    })();
    return () => { alive = false; };
  }, [repo, sessionId]);

  // Per-repo SSE (≤1 orchestrator per repo). Live events fold into the transcript;
  // permission events maintain the parked-approvals list.
  useEffect(() => {
    if (!repo) return;
    const es = new EventSource(`/api/orchestrator/stream?repo=${encodeURIComponent(repo)}`);
    es.onmessage = (ev) => {
      let e: OrchestratorEvent;
      try { e = JSON.parse(ev.data); } catch { return; }
      if (e.kind === 'permission' && e.permission) {
        setPending((p) => (p.some((x) => x.requestId === e.permission!.requestId) ? p : [...p, e.permission!]));
        return;
      }
      if (e.kind === 'permission_resolved' && e.permission) {
        setPending((p) => p.filter((x) => x.requestId !== e.permission!.requestId));
        return;
      }
      setItems((prev) => applyEvent(prev, e));
      if (e.kind === 'init') { setStatus('running'); if (e.sessionId) setLiveSessionId(e.sessionId); }
      else if (e.kind === 'exit') { setStatus('stopped'); setPending([]); }
      else if (e.kind === 'error') setStatus('error');
    };
    es.onerror = () => { /* EventSource auto-reconnects via Last-Event-ID */ };
    return () => es.close();
  }, [repo]);

  // Poll status so the panel reflects a running orchestrator even before the first
  // message (the SDK emits `init` only on the first turn) and reconciles pending
  // approvals if an SSE event was missed. The server is authoritative.
  useEffect(() => {
    if (!repo) return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const d: StatusResponse = await (await fetch(`/api/orchestrator/status?repo=${encodeURIComponent(repo)}`)).json();
        if (!alive || !d.ok) return;
        setStatus(d.status ?? 'idle');
        setLiveSessionId(d.sessionId ?? null);
        setPending(d.pending ?? []);
      } catch { /* keep last known */ }
    }, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [repo]);

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [items, pending]);

  const beginSession = useCallback(async (resume?: string) => {
    setBusy(true); setNotice(null);
    try {
      const d = await postJson<StatusResponse>('/api/orchestrator/start', { repo, ...(resume ? { resume } : {}) });
      if (d.ok) { setStatus(d.status ?? 'running'); setLiveSessionId(d.sessionId ?? null); }
      else setNotice('Could not start the orchestrator.');
    } catch { setNotice('Could not start the orchestrator.'); }
    finally { setBusy(false); }
  }, [repo]);

  const stop = useCallback(async () => {
    setBusy(true); setNotice(null);
    try { await postJson<OkResponse>('/api/orchestrator/stop', { repo }); setStatus('stopped'); setPending([]); }
    catch { setNotice('Could not stop the orchestrator.'); }
    finally { setBusy(false); }
  }, [repo]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !isLive) return;
    setInput('');
    setItems((prev) => [...prev, { kind: 'user', text }]);
    try {
      const d = await postJson<OkResponse>('/api/orchestrator/message', { repo, text });
      if (!d.ok) setItems((prev) => [...prev, { kind: 'system', text: 'Message failed to send.' }]);
    } catch { setItems((prev) => [...prev, { kind: 'system', text: 'Message failed to send.' }]); }
  }, [input, repo, isLive]);

  const decide = useCallback((req: PermissionRequest, decision: PermissionDecision) => {
    setPending((p) => p.filter((x) => x.requestId !== req.requestId)); // optimistic
    void postJson<OkResponse>('/api/orchestrator/permission', { repo, requestId: req.requestId, decision });
  }, [repo]);

  return (
    <div className="oc">
      <div className="oc-bar">
        <span className={`oc-status oc-${isLive ? status : isHistorical ? 'history' : status}`}>
          {isLive && <span className="oc-dot" />}
          {isLive ? 'live' : sessionId === LIVE ? status : 'past session'}
        </span>
        {isLive && liveSessionId && <span className="oc-sid mono" title={liveSessionId}>{liveSessionId}</span>}
        {isHistorical && sessionId !== LIVE && <span className="oc-sid mono" title={sessionId}>{sessionId}</span>}
        <span className="oc-spacer" />
        {isLive ? (
          <button type="button" className="oc-btn" disabled={busy} onClick={() => void stop()}>Stop</button>
        ) : sessionId === LIVE ? (
          <button type="button" className="oc-btn oc-primary" disabled={busy || !repo} onClick={() => void beginSession()}>Start</button>
        ) : (
          <button type="button" className="oc-btn oc-primary" disabled={busy} onClick={() => void beginSession(sessionId)}>Resume session</button>
        )}
      </div>

      <div className="oc-transcript" ref={scrollRef}>
        {items.length === 0 ? (
          <div className="oc-hint">
            {isLive ? 'Say hello to the orchestrator.'
              : sessionId === LIVE ? 'Start an orchestrator to chat.'
              : 'No prior messages in this session. Resume it to continue.'}
          </div>
        ) : (
          items.map((it, i) => <TranscriptItem key={i} item={it} repo={repo} />)
        )}
        {isHistorical && items.length > 0 && <div className="oc-histmark">— end of past session —</div>}
      </div>

      {pending.length > 0 && (
        <div className="oc-perms">
          {pending.map((req) => <PermissionCard key={req.requestId} req={req} repo={repo} onDecide={decide} />)}
        </div>
      )}

      {notice && <div className="oc-notice">{notice}</div>}

      <form className="oc-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea
          className="oc-textarea"
          rows={2}
          aria-label="Message the orchestrator"
          placeholder={isLive ? 'Message the orchestrator…' : 'Resume this session to send a message'}
          value={input}
          disabled={!isLive}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        <button type="submit" className="oc-btn oc-primary" disabled={!isLive || input.trim() === ''}>Send</button>
      </form>
    </div>
  );
}

function PermissionCard({ req, repo, onDecide }: {
  req: PermissionRequest;
  repo: string;
  onDecide: (req: PermissionRequest, d: PermissionDecision) => void;
}) {
  const label = req.title || `Run ${req.displayName || req.toolName}`;
  const detail = toolSummary(req.input);
  return (
    <div className="oc-perm">
      <div className="oc-perm-head">
        <span className="oc-perm-badge">needs approval</span>
        <span className="oc-perm-tool">{req.displayName || req.toolName}</span>
        {req.agentId && <span className="oc-perm-agent mono">{req.agentId}</span>}
      </div>
      <div className="oc-perm-body">{label}</div>
      {detail && <div className="oc-perm-detail mono">{linkify(detail, repo)}</div>}
      <div className="oc-perm-actions">
        <button type="button" className="oc-btn oc-primary" onClick={() => onDecide(req, 'allow')}>Approve</button>
        <button type="button" className="oc-btn" onClick={() => onDecide(req, 'always')}>Always allow</button>
        <button type="button" className="oc-btn oc-danger" onClick={() => onDecide(req, 'deny')}>Deny</button>
      </div>
    </div>
  );
}

function TranscriptItem({ item, repo }: { item: Item; repo: string }) {
  switch (item.kind) {
    case 'user':
      return <div className="oc-msg oc-user"><div className="oc-bubble">{linkify(item.text, repo)}</div></div>;
    case 'assistant':
      return (
        <div className="oc-msg oc-assistant">
          <div className="oc-bubble">{linkify(item.text, repo)}{!item.done && <span className="oc-caret" />}</div>
        </div>
      );
    case 'tool':
      return <div className="oc-tool">⚙ {item.name}{item.summary && <span className="oc-tool-arg mono">: {linkify(item.summary, repo)}</span>}</div>;
    case 'result':
      return <div className="oc-result">✓ done{item.tokens != null ? ` · ${item.tokens.toLocaleString()} tok` : ''}</div>;
    case 'system':
      return <div className="oc-system">{item.text}</div>;
  }
}
