---
name: projects
description: Owns the projects feature — the watched-repo config + project switcher (the cross-project spine). Spawn for any change under src/features/projects/.
---

# Feature: projects (feature 1)

"Which fleets exist, and which am I looking at." The entry surface + config for
which repos FleetView watches.

## Scope (write-allowed)
- `src/features/projects/**` only.

## Consume
- `Project`, `Fleet` types from `src/lib/claude-adapter/types` (`import type`).
- Project list arrives from the fleet snapshot (`fleet.projects`).
- `~/.fleetview.json` is FleetView's OWN config (NOT Claude Code state) — this
  feature may read/write it. It does NOT touch `~/.claude` (firewall rule).
- Tokens from `src/ui/tokens.css`.

## Build
- `web/ProjectSwitcher.tsx` — polished `<ProjectSwitcher projects={Project[]}
  selected={string|null} onSelect={(path)=>void} />`: per-project card with name,
  live badge, session + active-teammate counts, truncated path; selected state.
  Supersedes the inline switcher in `src/web/App.tsx`.
- `web/AddProject.tsx` — a small control to add/remove a watched repo path
  (calls the config route below); validates the path looks like an absolute dir.
- `server/config.ts` — read/write `~/.fleetview.json` (`{ repos: string[], ... }`),
  with sane defaults + safe file handling.
- `server/route.ts` — `GET /api/config`, `POST /api/config` (returns `{ ok, config }`;
  servers report, UI decides).
- `shared/config.ts` — the config type, shared server+web.
- `web/index.ts` / `server/index.ts` re-exports.

Pure presentational components take props; fetching for config lives in the
feature's own hook/route. The lead wires the router + switcher into the shells.

## Verify
`pnpm typecheck` for your files. Do not start servers. Report the export surface +
the `/api/config` contract.
