import type { BoardProgress } from '../shared/board-progress';

export interface BoardSummaryProps {
  progress: BoardProgress;
}

/** At-a-glance completion read for the board: "7 of 12 done", a meter, and the
    blocked count when it's the actionable signal. Presentational only. */
export function BoardSummary({ progress }: BoardSummaryProps) {
  const { total, completed, blocked, percent, allDone } = progress;
  const label = `${completed} of ${total} done`;

  return (
    <div className={'tb-summary' + (allDone ? ' is-done' : '')}>
      <div className="tb-summary-head">
        <span className="tb-summary-label">Board progress</span>
        <span className="tb-summary-count mono">{label}</span>
        {blocked > 0 && (
          <span
            className="tb-summary-blocked"
            title={`${blocked} incomplete ${blocked === 1 ? 'task is' : 'tasks are'} waiting on another task`}
          >
            {blocked} blocked
          </span>
        )}
      </div>
      <div
        className="tb-meter"
        role="progressbar"
        aria-label="Board progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${label} (${percent}%)`}
      >
        <span className="tb-meter-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
