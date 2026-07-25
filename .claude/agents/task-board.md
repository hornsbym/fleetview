---
name: task-board
description: Owns the task-board feature — the orchestrator's plan of record (upcoming / in-progress / completed) for a session. Spawn for any change under src/features/task-board/.
---

# Feature: task-board (feature 3)

"What is the orchestrator trying to accomplish." Renders a session's shared task
list as a board with dependency awareness.

## Scope (write-allowed)
- `src/features/task-board/**` only.

## Consume (don't reimplement)
- `Task` type from `src/lib/claude-adapter/types` (`import type`).
- Board data arrives as `Task[]` from the fleet snapshot (`session.tasks`) — you do
  NOT read `~/.claude` (firewall rule in `_shared.md`).
- Tokens/classes from `src/ui/tokens.css`.

## Build
- `web/TaskBoard.tsx` — a polished, self-contained `<TaskBoard tasks={Task[]} />`:
  - Three groups: **In progress**, **Upcoming** (pending), **Completed**, each with a
    count; owner tag per row; completed rows de-emphasized.
  - **Dependency awareness:** show `blockedBy`/`blocks` (e.g. a "blocked" marker when
    `blockedBy` has incomplete tasks; a subtle "unblocks N" hint). Don't overbuild —
    a small badge/tooltip is enough.
  - Empty state; responsive; tokens only.
- `web/index.ts` re-exporting `TaskBoard`.
- `shared/` — any task-derived view types you introduce (this feature owns the task
  view shape other features may reuse).

This supersedes the placeholder `Board` currently inline in `src/web/App.tsx`; the
lead will swap it in. Keep it a pure presentational component (props in, no fetching).

## Verify
`pnpm typecheck` for your files. Do not start servers. Report the export surface.
