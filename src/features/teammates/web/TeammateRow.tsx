import type { Teammate, TeammatePhase } from '../../../lib/claude-adapter/types';
import { relativeTime } from './relativeTime';

function shortModel(raw: string): string {
  // Strip common prefixes/suffixes to get a readable short name.
  // "us.anthropic.claude-opus-4-6-v1" → "opus 4.6"
  // "claude-sonnet-4-5-20251001" → "sonnet 4.5"
  // "claude-opus-4-6" → "opus 4.6"
  const m = raw.match(/(?:claude-?)?(opus|sonnet|haiku|fable)[- ]?(\d+)[- ]?(\d+)?/i);
  if (m) {
    const family = m[1].toLowerCase();
    const major = m[2];
    const minor = m[3] || '0';
    return `${family} ${major}.${minor}`;
  }
  // Fallback: strip provider prefix
  return raw.replace(/^us\.anthropic\./, '').replace(/^anthropic\./, '');
}

// The three plan statuses we style; anything else degrades to "pending".
type PlanStatus = 'pending' | 'in_progress' | 'completed';
function normalizeStatus(s: string): PlanStatus {
  return s === 'completed' || s === 'in_progress' ? s : 'pending';
}

// Human labels for the M6 lifecycle phases. Unknown phases fall back to raw text.
const PHASE_LABELS: Record<TeammatePhase, string> = {
  planning: 'planning',
  'awaiting-approval': 'awaiting approval',
  working: 'working',
  done: 'done',
  blocked: 'blocked',
};
function isKnownPhase(p: string): p is TeammatePhase {
  return p in PHASE_LABELS;
}

// Last path segment of a worktree, for a compact label; full path in the title.
function worktreeLabel(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export interface TeammateRowProps {
  m: Teammate;
  /** Approve the agent's plan (only offered when phase === 'awaiting-approval'). */
  onApprove?: (m: Teammate) => void;
  /** Ask the agent to revise its plan before proceeding. */
  onRequestChanges?: (m: Teammate) => void;
  /** False when FleetView doesn't own a running orchestrator for this repo — the
   *  approval buttons can't act (they'd misfire), so they're shown disabled. */
  approvable?: boolean;
}

/** One agent's live activity: identity, phase, task, "doing now", and checklist. */
export function TeammateRow({ m, onApprove, onRequestChanges, approvable = true }: TeammateRowProps) {
  // Liveness is only meaningful for subagents that have a transcript to read.
  const showState = !m.isLead && m.hasTranscript;
  const active = showState && !m.stale;
  const stateClass = m.isLead ? 'is-lead' : active ? 'is-active' : showState ? 'is-idle' : '';

  const phase = m.phase;
  const phaseKnown = phase != null && isKnownPhase(phase);
  const phaseText = phaseKnown ? PHASE_LABELS[phase] : phase;
  const awaitingApproval = phase === 'awaiting-approval';
  const donePhase = phase === 'done';
  const showApproval = awaitingApproval && (onApprove || onRequestChanges);

  const taskText = m.task ? (m.task.activeForm ?? m.task.subject) : null;
  const when = relativeTime(m.actionAt);

  const plan = m.plan ?? [];
  const total = plan.length;
  // 'done' phase reads as fully complete even if plan.json lagged behind.
  const done = donePhase ? total : plan.filter((p) => p.status === 'completed').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const planClass =
    'tm-plan' + (donePhase ? ' is-done' : '') + (phase === 'blocked' ? ' is-blocked' : '');

  return (
    <article className={`tm-row ${stateClass}`.trim()}>
      <header className="tm-head">
        <span className={'tm-role' + (m.isLead ? ' lead' : '')}>
          {m.isLead ? 'orchestrator' : 'teammate'}
        </span>
        <span className="tm-name">{m.agentType || m.name}</span>
        {m.model && <span className="tm-model mono">{shortModel(m.model)}</span>}
        {phase && (
          <span className={'tm-phase' + (phaseKnown ? ` ${phase}` : '')}>{phaseText}</span>
        )}
        {showState &&
          (active ? (
            <span className="live"><span className="dot" />active</span>
          ) : (
            <span className="idle">◦ idle</span>
          ))}
        {m.worktree && (
          <span className="tm-worktree mono" title={m.worktree}>
            ⌥ {worktreeLabel(m.worktree)}
          </span>
        )}
      </header>

      {taskText ? (
        <p className="tm-task"><span className="tm-k">task</span>{taskText}</p>
      ) : m.desc ? (
        <p className="tm-task"><span className="tm-k">brief</span>{m.desc}</p>
      ) : (
        <p className="tm-none">no in-progress task</p>
      )}

      {m.action && (
        <p className={'tm-doing' + (m.stale ? ' stale' : '')}>
          <span className="tm-k">{m.stale ? 'last' : 'doing'}</span>
          <span className="tm-action mono">{m.action}</span>
          {when && <time className="tm-when">{when}</time>}
        </p>
      )}

      {total > 0 && (
        <div className={planClass}>
          <div className="tm-plan-head">
            <span className="tm-plan-title">{awaitingApproval ? 'proposed plan' : 'checklist'}</span>
            <span className="tm-plan-count">{done}/{total}</span>
            <span className="tm-progress" aria-hidden="true">
              {/* width is data-driven completion %, not a styling constant */}
              <span className="tm-progress-fill" style={{ width: `${pct}%` }} />
            </span>
          </div>
          <ul className="tm-plan-list">
            {plan.map((p, i) => (
              <li key={i} className={`tm-plan-item ${normalizeStatus(p.status)}`}>
                <span className="tm-box" aria-hidden="true" />
                <span className="tm-plan-text">{p.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showApproval && (
        <div className="tm-approval">
          {onApprove && (
            <button
              type="button"
              className="tm-btn tm-btn-approve"
              onClick={() => onApprove(m)}
              disabled={!approvable}
              title={approvable ? undefined : "Start this project's orchestrator in FleetView to approve"}
            >
              Approve plan
            </button>
          )}
          {onRequestChanges && (
            <button
              type="button"
              className="tm-btn tm-btn-secondary"
              onClick={() => onRequestChanges(m)}
              disabled={!approvable}
              title={approvable ? undefined : "Start this project's orchestrator in FleetView to approve"}
            >
              Request changes
            </button>
          )}
          {!approvable && (
            <span className="tm-approval-hint">Start this project's orchestrator to approve</span>
          )}
        </div>
      )}
    </article>
  );
}
