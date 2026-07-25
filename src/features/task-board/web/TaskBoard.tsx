import type { Task } from '../../../lib/claude-adapter/types';
import { type TaskGroup, groupTasks, indexById, isCompleted, taskDeps } from '../shared/task-view';
import './TaskBoard.css';

export interface TaskBoardProps {
  tasks: Task[];
}

/** The orchestrator's plan of record: tasks grouped into In progress / Upcoming /
    Completed with counts, owner tags, and dependency hints. Pure presentational:
    props in, no fetching. */
export function TaskBoard({ tasks }: TaskBoardProps) {
  if (!tasks || tasks.length === 0) {
    return <p className="tb-empty">No tasks on the board yet.</p>;
  }

  const byId = indexById(tasks);
  const groups = groupTasks(tasks);

  return (
    <div className="tb-board">
      {groups.map((g) => (
        <TaskGroupView key={g.key} group={g} byId={byId} />
      ))}
    </div>
  );
}

function TaskGroupView({ group, byId }: { group: TaskGroup; byId: Map<string, Task> }) {
  return (
    <section className="tb-group" aria-label={group.label}>
      <div className="tb-group-head">
        <span className="tb-group-title">{group.label}</span>
        <span className="tb-count mono">{group.tasks.length}</span>
      </div>
      {group.tasks.length > 0 ? (
        <ul className="tb-list">
          {group.tasks.map((t) => (
            <TaskRow key={t.id} task={t} groupKey={group.key} byId={byId} />
          ))}
        </ul>
      ) : (
        <p className="tb-none">Nothing here.</p>
      )}
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
