// Task-view shapes derived from the adapter's Task. This feature owns the board's
// grouping + dependency model; teammates reuses these helpers so a per-owner
// checklist matches the board exactly.
import type { Task } from '../../../lib/claude-adapter/types';

export type TaskGroupKey = 'in_progress' | 'pending' | 'completed' | 'other';

export interface TaskGroup {
  key: TaskGroupKey;
  label: string;
  tasks: Task[];
}

/** A task's dependency picture, resolved against the current snapshot. */
export interface TaskDeps {
  /** Incomplete tasks this one is waiting on (the active blockers). */
  waitingOn: Task[];
  /** Not-yet-done tasks this one unblocks once it completes. */
  unblocks: Task[];
  /** True when at least one blocker is still incomplete. */
  blocked: boolean;
}

const GROUP_LABELS: Record<TaskGroupKey, string> = {
  in_progress: 'In progress',
  pending: 'Upcoming',
  completed: 'Completed',
  other: 'Other',
};

/** Groups always rendered (even when empty) so the board reads as a stable plan. */
export const PRIMARY_GROUPS: readonly TaskGroupKey[] = ['in_progress', 'pending', 'completed'];

export function isCompleted(t: Task): boolean {
  return t.status === 'completed';
}

function groupKey(status: Task['status']): TaskGroupKey {
  // Return literals directly: `Task['status']` includes `(string & {})`, which
  // defeats narrowing back to TaskGroupKey when returning `status` itself.
  if (status === 'in_progress') return 'in_progress';
  if (status === 'pending') return 'pending';
  if (status === 'completed') return 'completed';
  return 'other';
}

export function indexById(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

/** Canonical order: In progress → Upcoming → Completed → Other. Primary groups
 *  are always present; Other appears only when it has rows. Input order is kept. */
export function groupTasks(tasks: Task[]): TaskGroup[] {
  const buckets: Record<TaskGroupKey, Task[]> = {
    in_progress: [],
    pending: [],
    completed: [],
    other: [],
  };
  for (const t of tasks) buckets[groupKey(t.status)].push(t);
  const order: TaskGroupKey[] = ['in_progress', 'pending', 'completed', 'other'];
  return order
    .filter((k) => k !== 'other' || buckets.other.length > 0)
    .map((k) => ({ key: k, label: GROUP_LABELS[k], tasks: buckets[k] }));
}

/** Resolve a task's dependencies against a byId index. Ids missing from the
 *  snapshot are ignored — we only reason about tasks we can actually see. */
export function taskDeps(task: Task, byId: Map<string, Task>): TaskDeps {
  const resolve = (ids?: string[]) =>
    (ids ?? []).map((id) => byId.get(id)).filter((t): t is Task => t != null);
  const waitingOn = resolve(task.blockedBy).filter((t) => !isCompleted(t));
  const unblocks = resolve(task.blocks).filter((t) => !isCompleted(t));
  return { waitingOn, unblocks, blocked: waitingOn.length > 0 };
}
