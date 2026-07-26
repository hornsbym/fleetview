import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Task } from '../../../lib/claude-adapter/types';
import { type TaskGroup, groupTasks, indexById, isCompleted, taskDeps } from '../shared/task-view';
import { boardIdentity, boardProgress, shouldCollapseCompleted } from '../shared/board-progress';
import { BoardSummary } from './BoardSummary';
import './TaskBoard.css';

export interface TaskBoardProps {
  tasks: Task[];
}

/** The orchestrator's plan of record: a progress summary over tasks grouped into
    In progress / Upcoming / Completed, with counts, owner tags, and dependency
    hints. Pure presentational: props in, no fetching. */
export function TaskBoard({ tasks }: TaskBoardProps) {
  const list = tasks ?? [];
  const byId = useMemo(() => indexById(list), [list]);
  const groups = useMemo(() => groupTasks(list), [list]);
  const progress = useMemo(() => boardProgress(list), [list]);
  const identity = useMemo(() => boardIdentity(list), [list]);

  // A user's toggle always wins; the default only re-latches for a different
  // board, so polling can't re-collapse the group under the cursor.
  const [collapsed, setCollapsed] = useState(() => shouldCollapseCompleted(progress.completed));
  const latched = useRef(identity);
  useEffect(() => {
    if (latched.current === identity) return;
    latched.current = identity;
    setCollapsed(shouldCollapseCompleted(progress.completed));
  }, [identity, progress.completed]);

  if (list.length === 0) {
    return <p className="tb-empty">No tasks on the board yet.</p>;
  }

  return (
    <div className="tb-board">
      <BoardSummary progress={progress} />
      {groups.map((g) => {
        const collapsible = g.key === 'completed' && g.tasks.length > 0;
        return (
          <TaskGroupView
            key={g.key}
            group={g}
            byId={byId}
            collapsible={collapsible}
            collapsed={collapsible && collapsed}
            onToggle={() => setCollapsed((c) => !c)}
          />
        );
      })}
    </div>
  );
}

function TaskGroupView({
  group,
  byId,
  collapsible = false,
  collapsed = false,
  onToggle,
}: {
  group: TaskGroup;
  byId: Map<string, Task>;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const bodyId = useId();
  const head = (
    <>
      <span className="tb-group-title">{group.label}</span>
      <span className="tb-count mono">{group.tasks.length}</span>
    </>
  );

  return (
    <section className="tb-group" aria-label={group.label}>
      {collapsible ? (
        <button
          type="button"
          className="tb-group-head tb-group-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="tb-chevron" aria-hidden="true" />
          {head}
          <span className="tb-toggle-hint">{collapsed ? 'Show' : 'Hide'}</span>
        </button>
      ) : (
        <div className="tb-group-head">{head}</div>
      )}
      <div className="tb-group-body" id={bodyId} hidden={collapsible && collapsed}>
        {group.tasks.length > 0 ? (
          <ul className="tb-list">
            {group.tasks.map((t) => (
              <TaskRow key={t.id} task={t} groupKey={group.key} byId={byId} />
            ))}
          </ul>
        ) : (
          <p className="tb-none">Nothing here.</p>
        )}
      </div>
    </section>
  );
}

function TaskRow({
  task,
  groupKey,
  byId,
}: {
  task: Task;
  groupKey: TaskGroup['key'];
  byId: Map<string, Task>;
}) {
  // Completed tasks can't be blocked and have already done their unblocking.
  const deps = isCompleted(task) ? null : taskDeps(task, byId);

  return (
    <li className={`tb-row ${groupKey}`}>
      <span className="tb-subject">{task.subject}</span>
      <span className="tb-tags">
        {deps?.blocked && (
          <span
            className="tb-badge blocked"
            title={`Waiting on: ${deps.waitingOn.map((t) => t.subject).join(', ')}`}
          >
            blocked
          </span>
        )}
        {deps && deps.unblocks.length > 0 && (
          <span
            className="tb-badge unblocks"
            title={`Unblocks: ${deps.unblocks.map((t) => t.subject).join(', ')}`}
          >
            unblocks {deps.unblocks.length}
          </span>
        )}
        {task.owner && (
          <span className="tb-owner mono" title={`owner: ${task.owner}`}>
            {task.owner}
          </span>
        )}
      </span>
    </li>
  );
}
