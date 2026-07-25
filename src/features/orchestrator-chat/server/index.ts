// Server surface for orchestrator-chat (mounted by the lead in src/server/main.ts).
export { handleOrchestratorRoute } from './route';
export {
  getOrchestratorStatus,
  sendToOrchestrator,
  startOrchestrator,
  stopOrchestrator,
  stopAll,
} from './manager';
export type {
  MessageRequest,
  OkResponse,
  RepoRequest,
  SeqEvent,
  StartRequest,
  StatusResponse,
} from '../shared/events';
