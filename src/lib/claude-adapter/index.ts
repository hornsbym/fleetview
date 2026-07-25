// @fleetview/claude-adapter — the ONLY module allowed to touch Claude Code's
// on-disk state, transcripts, or CLI. Features consume this typed interface and
// never reach past it. If Claude Code changes its internals, this is the edit.
import { execFileSync } from 'node:child_process';
import { buildFleet } from './internal/fleet';
import type { Fleet, FleetConfig } from './types';

export * from './types';
export { createOrchestrator } from './internal/orchestrator';

/** Monitor plane: a normalized snapshot of every project/session/teammate. */
export async function readFleet(config: FleetConfig = {}): Promise<Fleet> {
  return buildFleet(config);
}

/** Installed Claude Code version — used for graceful degradation later. */
export function claudeVersion(): string {
  try { return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

// Control plane: createOrchestrator() spawns & drives a stream-json orchestrator.
