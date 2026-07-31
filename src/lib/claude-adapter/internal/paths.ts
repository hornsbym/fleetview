// The ONLY place that knows where Claude Code keeps its state on disk.
// If a future CC version relocates these, this file is the single edit.
import { homedir } from 'node:os';
import path from 'node:path';

export const HOME = homedir();
export const CLAUDE = path.join(HOME, '.claude');
export const TEAMS = path.join(CLAUDE, 'teams');
export const PROJECTS = path.join(CLAUDE, 'projects');

/** Claude encodes a cwd into a project dir name by replacing non-alnum with '-'. */
export const encodeCwd = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');
