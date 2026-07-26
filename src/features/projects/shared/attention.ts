// "Does this project need a human?" — derived from the fleet snapshot the switcher
// already receives. Pure and dependency-free (type-only imports) so any surface —
// switcher today, a topbar summary later — can reuse the exact same reading.
import type { Project } from '../../../lib/claude-adapter/types';

export interface ProjectAttention {
  /** Agents parked on a plan only a human can approve — the signal that means "you". */
  awaitingApproval: number;
  /** Agents that self-reported `blocked`. */
  blocked: number;
  /** Working-but-not-advancing subagents. Informational: never flags a project. */
  stalled: number;
  /** True when a human decision is outstanding. */
  needsAttention: boolean;
}

/** Counts of every attention signal in a project, plus the "needs you" verdict.
 *  Only live sessions count: `phase` is populated for live-session subagents only,
 *  so a finished session could contribute flags nobody can ever clear. */
export function projectAttention(project: Project): ProjectAttention {
  let awaitingApproval = 0;
  let blocked = 0;
  let stalled = 0;
  const seen = new Set<string>();

  for (const session of project?.sessions ?? []) {
    if (!session?.live) continue;
    // An owned orchestrator parked on a tool-permission request needs you now —
    // same "awaiting approval" signal as a teammate parked on a plan.
    if (session.needsApproval) awaitingApproval++;
    for (const m of session.members ?? []) {
      if (!m) continue;
      if (m.agentId) {
        if (seen.has(m.agentId)) continue;
        seen.add(m.agentId);
      }
      // Unknown phase strings simply fall through to the stalled check.
      if (m.phase === 'awaiting-approval') awaitingApproval++;
      else if (m.phase === 'blocked') blocked++;
      // Reached only when not already counted above: an agent parked for approval
      // goes stale by design, and double-badging it would make the strong signal
      // look like noise. A lead or transcript-less member can't be judged at all.
      else if (!m.isLead && m.hasTranscript && m.stale && m.phase !== 'done') stalled++;
    }
  }

  return { awaitingApproval, blocked, stalled, needsAttention: awaitingApproval + blocked > 0 };
}

/** Rank by presence, not count: counts flicker on every 2.5s poll, so ranking by
 *  them would churn the list; presence changes only when a project's state does. */
function attentionTier(a: ProjectAttention): number {
  if (a.awaitingApproval > 0) return 2;
  if (a.blocked > 0) return 1;
  return 0;
}

/** Floats attention-needing projects to the top (awaiting-approval above blocked),
 *  preserving input order exactly within each tier. Never mutates the input. */
export function sortByAttention(projects: Project[]): Project[] {
  return (projects ?? [])
    .map((project, index) => ({ project, index, tier: attentionTier(projectAttention(project)) }))
    .sort((a, b) => b.tier - a.tier || a.index - b.index)
    .map((entry) => entry.project);
}
