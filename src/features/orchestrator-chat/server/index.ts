// Server surface for orchestrator-chat (mounted by the lead in src/server/main.ts).
export { handleOrchestratorRoute } from './route';
export {
  controlSnapshot,
  getOrchestratorStatus,
  respondPermission,
  sendToOrchestrator,
  startOrchestrator,
  stopOrchestrator,
  stopAll,
} from './manager';
export type {
  HistoryResponse,
  MessageRequest,
  OkResponse,
  PermissionResponseRequest,
  RepoRequest,
  SeqEvent,
  StartRequest,
  StatusResponse,
} from '../shared/events';
