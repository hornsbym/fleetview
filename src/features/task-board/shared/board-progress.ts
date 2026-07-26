// Board-level derivation: the at-a-glance completion read, plus the collapse
// policy for the Completed group. Pure functions so the React layer only renders
// and other features (teammates) can reuse the same numbers.
import type { Task } from '../../../lib/claude-adapter/types';
import { indexById, isCompleted, taskDeps } from './task-view';

export interface BoardProgress {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  /** Incomplete tasks waiting on at least one incomplete blocker in this snapshot. */
  blocked: number;
  /** 0–100. Reaches 100 only when every task is genuinely done. */
  percent: number;
  allDone: boolean;
}

/** Completed lists at or above this size start collapsed, so a long finished
 *  list can't bury In progress / Upcoming. */
export const COMPLETED_COLLAPSE_MIN = 5;

export function shouldCollapseCompleted(completedCount: number): boolean {
  return completedCount >= COMPLETED_COLLAPSE_MIN;
}

/** Rounds toward the truth: never claims 100% while work remains, and never
 *  reports 0% once something is done. */
function percentDone(completed: number, total: number): number {
  if (total <= 0) return 0;
  if (completed >= total) return 100;
  const pct = Math.round((completed / total) * 100);
  return Math.min(99, Math.max(completed > 0 ? 1 : 0, pct));
}

/** Board totals for the summary header. `blocked` reuses `taskDeps`, so the count
 *  can never disagree with the per-row "blocked" badges. */
export function boardProgress(tasks: Task[]): BoardProgress {
  const list = tasks ?? [];
  const byId = indexById(list);

  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let blocked = 0;

  for (const t of list) {
    if (isCompleted(t)) {
      completed++;
      continue;
    }
    if (t.status === 'in_progress') inProgress++;
    else if (t.status === 'pending') pending++;
    if (taskDeps(t, byId).blocked) blocked++;
  }

  const total = list.length;
  return {
    total,
    completed,
    inProgress,
    pending,
    blocked,
    percent: percentDone(completed, total),
    allDone: total > 0 && completed === total,
  };
}

/** Stable-ish identity for "is this the same board?". Order-independent (lowest
 *  id wins), so a re-sort, a new task, or a completion can't reset a user's
 *  collapse choice — only switching sessions does. */
export function boardIdentity(tasks: Task[]): string {
  let lowest = '';
  for (const t of tasks ?? []) {
    if (lowest === '' || t.id < lowest) lowest = t.id;
  }
  return lowest;
}
