// Server surface for the projects feature (mounted by the lead in src/server/main.ts).
export { handleConfigRoute } from './route';
export { readConfig, writeConfig, addRepo, removeRepo, CONFIG_PATH } from './config';
export type { FleetViewConfig, ConfigRequest, ConfigResponse } from '../shared/config';
