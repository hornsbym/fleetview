// Web surface for the projects feature (composed by the lead in src/web/App.tsx).
export { ProjectSwitcher } from './ProjectSwitcher';
export type { ProjectSwitcherProps } from './ProjectSwitcher';
export { AddProject } from './AddProject';
export type { AddProjectProps } from './AddProject';
export type { FleetViewConfig, ConfigResponse, ConfigRequest } from '../shared/config';
// Exported so other surfaces (e.g. a topbar "N need you" summary) read attention
// exactly the way the switcher does.
export { projectAttention, sortByAttention } from '../shared/attention';
export type { ProjectAttention } from '../shared/attention';
