// @fleetview/claude-adapter — the ONLY module allowed to touch Claude Code's
// on-disk state, transcripts, or CLI. Features consume this typed interface and
// never reach past it. If Claude Code changes its internals, this is the edit.
import { execFileSync } from 'node:child_process';
import { buildFleet } from './internal/fleet';
import type { ControlSnapshot, Fleet, FleetConfig } from './types';

export * from './types';
export { createOrchestrator } from './internal/orchestrator';
export { readOrchestratorHistory } from './internal/history';

/** Monitor plane: a normalized snapshot of every project/session/teammate. The
 *  optional control snapshot merges in what the control plane knows (which sessions
 *  FleetView is actively driving, and which are parked on an approval) so liveness
 *  no longer depends on the CLI's config.json, which it deletes when a lead exits. */
export async function readFleet(config: FleetConfig = {}, control?: ControlSnapshot): Promise<Fleet> {
  return buildFleet(config, control);
}

/** Installed Claude Code version — used for graceful degradation later. */
export function claudeVersion(): string {
  try { return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

// Control plane: createOrchestrator() spawns & drives a stream-json orchestrator.
