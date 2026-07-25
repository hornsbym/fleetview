# FleetView

A local, cross-project control-and-monitor dashboard for the Claude Code
orchestrator + feature-agent (agent-teams) workflow. Watch every project's
orchestrator and subagents, chat with an orchestrator, and drive plan-gated
feature work — from one browser tab.

## Requirements
- **Claude Code** (`claude` CLI) installed and authenticated.
- **Node 20.19+** and **pnpm**.
- *(optional)* the `code` (or `cursor`) CLI on PATH for click-to-open-file.

## Install & run

**Dev** (Vite + API, hot reload):
```sh
pnpm install
pnpm dev          # Vite on :5173, proxying /api → the Node server on :4317
```

**As a command** (`fleetview` builds the UI, serves it, and opens your browser):
```sh
pnpm install
npm link          # puts `fleetview` on your PATH, pointing at this repo
fleetview         # → http://127.0.0.1:4317
```
Use `npm link` (not a global copy) so the command runs from this repo, where the
build tooling lives. Remove with `npm unlink -g fleetview`.

## Configuration — `~/.fleetview.json`
```json
{
  "repos": [
    "/absolute/path/to/some/repo",
    "/absolute/path/to/another/repo"
  ],
  "editor": "code",
  "host": "127.0.0.1"
}
```
- **`repos`** — repos to watch (also manageable from the sidebar's *Add* control).
  Active work is discovered regardless; watched repos always appear so you can start
  an orchestrator in them.
- **`editor`** — CLI used to open files clicked in the chat (default `code`; `cursor` works).
- **`host`** — bind host (default `127.0.0.1`, localhost only). Set `"0.0.0.0"` to reach
  FleetView from other devices on your LAN at `http://<your-ip>:4317`. **FleetView is
  unauthenticated and can drive orchestrators / open files / read `~/.claude` — expose only
  on a trusted network.** (Env `HOST` overrides config; for dev, `HOST=0.0.0.0 pnpm dev`.)

## Two planes
- **Monitor** (read-only): projects, sessions, task boards, and each teammate's live
  "doing now" line + worktree — read from `~/.claude` (`teams`, `tasks`, `subagents`,
  transcripts) + `git worktree list`.
- **Control**: Start/Stop an orchestrator per repo and chat with it (streamed over SSE,
  with per-turn cost). FleetView spawns the *project's own* `claude` — it does **not**
  override the project's instructions.

## Plan-gated feature agents (opt-in)
If a project's agents follow the convention — write `.fleetview/plan.json` in their
worktree (`{ task, phase, steps }`) — FleetView shows an **approval card** for each
proposed plan and a **self-completing checklist** as the agent works. Progress is
self-reported by each agent, so the orchestrator never bottlenecks polling status; it
auto-approves routine plans and escalates substantial ones to you. Copy the pattern
from `.claude/agents/_shared.md` + `_orchestrator.md` into another project to adopt it.

## Click-to-open files
File paths in the orchestrator chat are clickable — `POST /api/open` → `<editor> -g <path>:<line>`.

## Flexibility
FleetView does **not** require a feature-by-folder layout. Any repo you drive with
Claude Code in the orchestrator/team style shows up; the plan-gated cards are the only
opt-in piece. Names adapt to whatever agent types a project defines.

## Layout
```
src/
  lib/claude-adapter/   # the ONLY code that touches ~/.claude / the CLI (the firewall)
  ui/                   # tokens + shared components (FileLink, …)
  server/               # Node http: composes feature routers + serves the build
  web/                  # React shell composing the feature UIs
  features/{projects,task-board,teammates,orchestrator-chat}/
.claude/agents/         # FleetView's own feature agents (built with the workflow it visualizes)
```

See **`PLAN.md`** for the full design and **`FUTURE.md`** for deferred work
(resume-after-restart).
