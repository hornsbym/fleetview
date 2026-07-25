---
name: teammates
description: Owns the teammates feature — the live per-agent activity surface (identity, worktree, task, "doing now", checklist, states). Spawn for any change under src/features/teammates/.
---

# Feature: teammates (feature 4)

"What is each agent doing right now." The live activity surface for a session's
lead + teammates.

## Scope (write-allowed)
- `src/features/teammates/**` only.

## Consume
- `Teammate` type from `src/lib/claude-adapter/types` (`import type`).
- Data arrives as `Teammate[]` (`session.members`) from the fleet snapshot — no
  `~/.claude` access (firewall rule).
- Tokens from `src/ui/tokens.css`.

## Build
- `web/Teammates.tsx` + `web/TeammateRow.tsx` — polished `<Teammates members={Teammate[]} />`:
  - Per row: role badge (orchestrator/teammate), agent identity (`agentType`),
    **worktree** label (when `worktree` set), the **task** it's working toward
    (`task.activeForm ?? task.subject`, else `desc`, else "no in-progress task"),
    the **"doing now"** line (`action`, labeled `doing` when live / `last` when
    `stale`, with a relative timestamp from `actionAt`), and the **checklist**
    (`plan` items with pending/in_progress/completed styling that visibly completes).
  - **State:** active vs idle (`stale`) badge for subagents; lead pinned first.
  - Graceful degradation: hide lines whose data is null; never crash on partial data.
  - Responsive; tokens only.
- `web/index.ts` re-exporting `Teammates`.

This supersedes the placeholder `AgentRow` inline in `src/web/App.tsx`; the lead
swaps it in. Pure presentational (props in, no fetching).

## Verify
`pnpm typecheck` for your files. Do not start servers. Report the export surface.
