// One session's page: a READ-ONLY view of a Claude Code session running in your
// terminal, plus the approval cards for permissions that session asked about.
//
// There is no composer. FleetView visualizes the session; the terminal drives it.
// The only interaction here is answering a permission prompt the session raised,
// which reaches us over Claude Code's own PermissionRequest hook.
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatItem, SessionEvent, PermissionDecision, PermissionRequest,
  HistoryResponse, PendingResponse, OkResponse, DigestResponse, SessionDigest,
  SummaryAnchor,
} from '../shared/events';
import './SessionView.css';
import './SessionEnvironment.css';
import { linkify } from '../../../ui/FileLink';
import { Markdown } from '../../../ui/Markdown';
import { SessionEnvironmentPanel } from './SessionEnvironment';

import { useVisiblePoll } from '../../../ui/useVisiblePoll';
import { FocusButton } from '../../terminal-focus/web';
import type { Session } from '../../../lib/claude-adapter/types';
import { Teammates } from '../../teammates/web/Teammates';
import { rosterOf } from '../../teammates/shared/roster';

export interface SessionViewProps {
  /** The resolved session — the fleet already knows liveness, so don't re-derive it. */
  session: Session | null;
  repo: string;
  sessionId: string;
  /** Lifts the digest to the page so the panels can live in the side column. */
  onDigest?: (d: SessionDigest | null) => void;
  /**
   * A request to scroll the transcript to a summary bullet's origin. `nonce`
   * exists so clicking the same bullet twice re-scrolls — the anchor alone is
   * unchanged and wouldn't re-fire the effect.
   */
  jumpTo?: { anchor: SummaryAnchor; nonce: number } | null;
}

/** How long the jumped-to entry stays highlighted. Long enough to find it after
 *  the scroll settles, short enough not to linger as decoration. */
const FLASH_MS = 1800;

/** Re-poll cadence for a live transcript. Claude Code appends to the session JSONL
 *  mid-turn, so a tail at this interval is materially the same as streaming — there
 *  is no token-level stream to lose (`includePartialMessages` is never set). */
const TAIL_MS = 2500;

function toolSummary(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  // description first: for Bash it's the human-readable sentence the model already
  // wrote, and it beats echoing a raw shell one-liner at the user.
  const pick = i.description ?? i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.prompt;
  if (typeof pick === 'string') return pick;
  try { const s = JSON.stringify(i); return s && s !== '{}' ? s : ''; } catch { return ''; }
}

function ago(at: string | undefined): string {
  if (!at) return '';
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function SessionView({ session, repo, sessionId, onDigest, jumpTo }: SessionViewProps) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  // Requests resolved (locally or externally), so a poll in flight can't resurrect the card.
  const decidedRef = useRef<Set<string>>(new Set());

  const live = !!session?.live;

  // Transcript: seed as soon as we know the session id.
  //
  // Deliberately NOT dependent on `live`. It used to be, which meant the effect
  // re-ran the moment the fleet poll resolved and flipped live false->true —
  // clearing the transcript it had just loaded and showing "Loading transcript…"
  // a second time. The history endpoint needs only the id, so this can start
  // immediately and in parallel with the fleet.
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    setItems([]); setLoaded(false); decidedRef.current = new Set();
    void (async () => {
      try {
        const h: HistoryResponse = await (
          await fetch(`/api/session/history?sessionId=${encodeURIComponent(sessionId)}`)
        ).json();
        if (alive && h.ok && h.items) setItems(h.items);
      } catch { /* leave what we have */ }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, [sessionId]);

  // Tail while live. Separate effect so starting/stopping the poll never resets
  // what's already on screen. Visibility-aware: a backgrounded tab is throttled to
  // near-zero ticks, so this also refreshes the moment you come back.
  const tail = useCallback(() => {
    if (!sessionId || !live) return;
    void (async () => {
      try {
        const h: HistoryResponse = await (
          await fetch(`/api/session/history?sessionId=${encodeURIComponent(sessionId)}`)
        ).json();
        if (h.ok && h.items) setItems(h.items);
      } catch { /* keep last known */ }
    })();
  }, [sessionId, live]);
  useVisiblePoll(tail, TAIL_MS, `${sessionId}:${live}`);

  // Digest ("doing now" + "done so far"). Scanned incrementally server-side, so
  // polling it is ~1ms after the first call even on a multi-MB transcript.
  const [digest, setDigest] = useState<SessionDigest | null>(null);
  useEffect(() => { setDigest(null); }, [sessionId]);
  const pullDigest = useCallback(() => {
    if (!sessionId) return;
    const q = new URLSearchParams({ sessionId, ...(session?.cwd ? { cwd: session.cwd } : {}) });
    void (async () => {
      try {
        const d: DigestResponse = await (await fetch(`/api/session/digest?${q}`)).json();
        if (d.ok && d.digest) { setDigest(d.digest); onDigest?.(d.digest); }
      } catch { /* keep last known */ }
    })();
  }, [sessionId, session?.cwd, onDigest]);
  useVisiblePoll(pullDigest, TAIL_MS, `${sessionId}:${live}`);

  // Parked permissions: pushed over SSE, reconciled by poll.
  useEffect(() => {
    if (!sessionId) return;
    const merge = (list: PermissionRequest[]) =>
      list.filter(r => !decidedRef.current.has(r.requestId));

    let alive = true;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const d: PendingResponse = await (
          await fetch(`/api/session/pending?sessionId=${encodeURIComponent(sessionId)}`)
        ).json();
        if (alive && d.ok) setPending(merge(d.pending ?? []));
      } catch { /* keep last known */ }
    };
    void poll();
    const id = setInterval(poll, TAIL_MS);
    const onVisible = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', onVisible);

    const es = new EventSource(`/api/session/stream?sessionId=${encodeURIComponent(sessionId)}`);
    es.onmessage = (ev) => {
      let e: SessionEvent;
      try { e = JSON.parse(ev.data); } catch { return; }
      if (e.kind === 'permission' && e.permission) {
        const p = e.permission;
        if (decidedRef.current.has(p.requestId)) return;
        setPending(prev => (prev.some(x => x.requestId === p.requestId) ? prev : [...prev, p]));
      } else if (e.kind === 'permission_resolved' && e.permission) {
        const p = e.permission;
        decidedRef.current.add(p.requestId);
        setPending(prev => prev.filter(x => x.requestId !== p.requestId));
      }
    };
    es.onerror = () => { /* EventSource reconnects via Last-Event-ID */ };

    return () => {
      alive = false; clearInterval(id); es.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionId]);

  // Stick to bottom only when the user is already there, so scrolling up to read
  // isn't yanked back by the next tail.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [items, pending]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  // Jump to a summary bullet's origin.
  //
  // Deliberately NOT dependent on `items`: the tail replaces that array every
  // 2.5s, and re-running this on each poll would keep dragging a reader back to
  // an old message they'd already scrolled away from. `nonce` is what re-fires it.
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!jumpTo || !el) return;
    const { confirmedBy, reportedBy } = jumpTo.anchor;
    // The message confirming the work is the useful destination; the report
    // write itself is the fallback, for a bullet whose confirmation hasn't been
    // written yet.
    const found = [confirmedBy, reportedBy].find(
      (id): id is string => !!id && !!el.querySelector(`[data-item-id="${CSS.escape(id)}"]`),
    );
    if (!found) return;
    const target = el.querySelector(`[data-item-id="${CSS.escape(found)}"]`) as HTMLElement;

    // Release the bottom-stick, or the next tail scrolls straight back down.
    stickRef.current = false;
    // Offset via rects rather than offsetTop, which would need the container to
    // be a positioned ancestor. A third of the way down puts the landing entry
    // under the eye with its lead-in still visible.
    const delta = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
    const top = el.scrollTop + delta - el.clientHeight / 3;
    // Smooth scrolling is driven by rAF, which is paused in a hidden or heavily
    // throttled tab — there the animation never advances and the jump silently
    // does nothing. Fall back to an instant one, which is also what a
    // reduced-motion preference asks for.
    const animate = !document.hidden
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top, behavior: animate ? 'smooth' : 'auto' });

    setFlashId(found);
    const t = setTimeout(() => setFlashId(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [jumpTo]);

  const [staleNotice, setStaleNotice] = useState<string | null>(null);

  const decide = useCallback(async (req: PermissionRequest, decision: PermissionDecision, updatedInput?: unknown) => {
    decidedRef.current.add(req.requestId);
    setPending(p => p.filter(x => x.requestId !== req.requestId));
    const body: any = { requestId: req.requestId, decision };
    if (updatedInput) body.updatedInput = updatedInput;
    const result = await postJson<OkResponse>('/api/session/permission', body);
    if (result && !result.ok) {
      setStaleNotice('Already resolved in terminal');
      setTimeout(() => setStaleNotice(null), 3000);
    }
  }, []);

  const label = session?.name || sessionId;

  return (
    <div className="oc">
      <div className="oc-bar">
        <span className={`oc-status oc-${live ? 'running' : 'history'}`}>
          {live && <span className="oc-dot" />}
          {live ? (session?.waitingFor ? `waiting · ${session.waitingFor}` : session?.status || 'live') : 'past session'}
        </span>
        <span className="oc-sid" title={sessionId}>{label}</span>
        {session?.kind === 'background' && <span className="oc-sid mono">bg</span>}
        <span className="oc-spacer" />
        <FocusButton sessionId={sessionId} live={live} cwd={session?.cwd} />
        <span className="oc-readonly" title="FleetView shows what your terminal session is doing; it never sends to it.">
          read-only
        </span>
      </div>

      <SessionEnvironmentPanel session={session} sessionId={sessionId} />

      {session?.members && rosterOf(session.members, { live }).active.filter(m => !m.isLead).length > 0 && (
        <Teammates members={session.members} session={{ live }} />
      )}

      <div className="oc-transcript" ref={scrollRef} onScroll={onScroll}>
        {items.length === 0 ? (
          <div className="oc-hint">
            {!loaded ? 'Loading transcript…'
              : live ? 'This session hasn’t said anything yet.'
              : 'No messages in this session.'}
          </div>
        ) : (
          items.map((it, i) => (
            <TranscriptItem key={i} item={it} repo={repo} flash={!!it.id && it.id === flashId} />
          ))
        )}
      </div>

      {staleNotice && <div className="oc-stale-notice">{staleNotice}</div>}
      {pending.length > 0 && (
        <div className="oc-perms">
          {pending.map(req => <PermissionCard key={req.requestId} req={req} repo={repo} onDecide={decide} />)}
        </div>
      )}
    </div>
  );
}

function PermissionCard({ req, repo, onDecide }: {
  req: PermissionRequest;
  repo: string;
  onDecide: (req: PermissionRequest, d: PermissionDecision, updatedInput?: unknown) => void;
}) {
  if (req.toolName === 'AskUserQuestion') return <QuestionCard req={req} onAnswer={onDecide} />;
  if (req.toolName === 'ExitPlanMode') return <PlanApprovalCard req={req} onDecide={onDecide} />;

  const detail = toolSummary(req.input);
  // agentId === null means the session's lead asked; anything else is a teammate.
  const who = req.agentId ? (req.agentType || req.agentId) : 'lead';
  return (
    <div className="oc-perm">
      <div className="oc-perm-head">
        <span className="oc-perm-badge">needs approval</span>
        <span className="oc-perm-tool">{req.toolName}</span>
        <span className="oc-perm-agent mono">{who}</span>
      </div>
      <div className="oc-perm-body">Run {req.toolName}</div>
      {detail && <div className="oc-perm-detail mono">{linkify(detail, repo)}</div>}
      <div className="oc-perm-actions">
        <button type="button" className="oc-btn oc-primary" onClick={() => onDecide(req, 'allow')}>Approve</button>
        <button type="button" className="oc-btn" onClick={() => onDecide(req, 'always')}>Always allow</button>
        <button type="button" className="oc-btn oc-danger" onClick={() => onDecide(req, 'deny')}>Deny</button>
      </div>
    </div>
  );
}

function QuestionCard({ req, onAnswer }: { req: PermissionRequest; onAnswer: (req: PermissionRequest, d: PermissionDecision, updatedInput?: unknown) => void }) {
  const input = req.input as { questions?: Array<{ question: string; header: string; options: Array<{label: string; description: string}>; multiSelect: boolean }> };
  const questions = input?.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState('');

  const submit = () => {
    const finalAnswers = { ...answers };
    // If there's custom text and a question without an answer, use it
    for (const q of questions) {
      if (!finalAnswers[q.question] && customText) finalAnswers[q.question] = customText;
    }
    onAnswer(req, 'allow', { ...input, answers: finalAnswers });
  };

  return (
    <div className="oc-question">
      <div className="oc-question-badge">?</div>
      {questions.map((q, qi) => (
        <div key={qi} className="oc-question-block">
          {q.header && <div className="oc-question-header">{q.header}</div>}
          <div className="oc-question-text">{q.question}</div>
          <div className="oc-options">
            {q.options.map((opt, oi) => (
              <button
                key={oi}
                type="button"
                className={'oc-option' + (answers[q.question] === opt.label ? ' selected' : '')}
                onClick={() => {
                  setAnswers(a => ({ ...a, [q.question]: opt.label }));
                  if (!q.multiSelect && questions.length === 1) {
                    // Auto-submit for single-select single-question
                    onAnswer(req, 'allow', { ...input, answers: { ...answers, [q.question]: opt.label } });
                  }
                }}
              >
                <span className="oc-option-label">{opt.label}</span>
                {opt.description && <span className="oc-option-desc">{opt.description}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="oc-answer-row">
        <input
          type="text"
          className="oc-answer-input"
          placeholder="Or type a custom answer..."
          value={customText}
          onChange={e => setCustomText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && customText) submit(); }}
        />
        {(questions.length > 1 || questions[0]?.multiSelect) && (
          <button type="button" className="oc-btn oc-primary" onClick={submit}>Submit</button>
        )}
      </div>
    </div>
  );
}

function PlanApprovalCard({ req, onDecide }: { req: PermissionRequest; onDecide: (req: PermissionRequest, d: PermissionDecision) => void }) {
  return (
    <div className="oc-plan-approval">
      <div className="oc-plan-approval-badge">📋</div>
      <div className="oc-plan-approval-text">Plan ready for review</div>
      <div className="oc-perm-actions">
        <button type="button" className="oc-btn oc-primary" onClick={() => onDecide(req, 'allow')}>Approve plan</button>
        <button type="button" className="oc-btn oc-danger" onClick={() => onDecide(req, 'deny')}>Reject</button>
      </div>
    </div>
  );
}

function Timestamp({ at }: { at?: string }) {
  const label = ago(at);
  if (!label) return null;
  return <span className="oc-ts">{label}</span>;
}

function TranscriptItem({ item, repo, flash }: { item: ChatItem; repo: string; flash?: boolean }) {
  // `data-item-id` is what makes an entry addressable from the summary panel;
  // the flash class is applied to the same element so the highlight lands where
  // the scroll does.
  const cls = (base: string) => (flash ? `${base} oc-jump-flash` : base);
  const id = item.id;

  switch (item.kind) {
    case 'user':
      return (
        <div className={cls('oc-msg oc-user')} data-item-id={id}>
          <Timestamp at={item.at} />
          <div className="oc-bubble">{linkify(item.text, repo)}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className={cls('oc-msg oc-assistant')} data-item-id={id}>
          <div className="oc-bubble"><Markdown text={item.text} repo={repo} /></div>
          <Timestamp at={item.at} />
        </div>
      );
    case 'tool':
      return <div className={cls('oc-tool')} data-item-id={id}>⚙ {item.name}{item.summary && <span className="oc-tool-arg mono">: {linkify(item.summary, repo)}</span>}</div>;
    case 'result':
      return <div className={cls('oc-result')} data-item-id={id}>✓ done{item.tokens != null ? ` · ${item.tokens.toLocaleString()} tok` : ''}</div>;
    case 'notification':
      return (
        <div className={cls('oc-notification')} data-item-id={id}>
          <span className="oc-notif-icon">⚡</span>
          <span>{item.text}</span>
        </div>
      );
    case 'plan':
      return (
        <details className={cls('oc-plan-card')} data-item-id={id} open>
          <summary className="oc-plan-header">
            Plan: {item.path.split('/').pop()}
          </summary>
          <div className="oc-plan-body">
            <Markdown text={item.text} repo={repo} />
          </div>
        </details>
      );
    default:
      return null;
  }
}
