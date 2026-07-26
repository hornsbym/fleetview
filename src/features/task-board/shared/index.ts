export type { TaskGroup, TaskGroupKey, TaskDeps } from './task-view';
export { groupTasks, taskDeps, indexById, isCompleted, PRIMARY_GROUPS } from './task-view';
export type { BoardProgress } from './board-progress';
export {
  boardProgress,
  boardIdentity,
  shouldCollapseCompleted,
  COMPLETED_COLLAPSE_MIN,
} from './board-progress';
