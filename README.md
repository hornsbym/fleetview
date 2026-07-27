# FleetView

A local, cross-project dashboard for the Claude Code sessions running on your
machine. See every session in every project — including the ones you started in a
terminal — watch what each agent is doing, read transcripts as they stream, and
**approve tool calls from the browser** instead of hunting for the terminal tab
that's blocked on a prompt.

**FleetView never drives your sessions.** It doesn't spawn them, message them,
resume them or stop them. Your terminal is the source of truth; FleetView is a
view onto it. The one interactive affordance — approving a tool call — is
FleetView answering a question the session asked, over Claude Code's own
`PermissionRequest` hook.

## Requirements
- **Claude Code** (`claude` CLI) installed and authenticated.
- **Node 20.19+** and **pnpm**.
- Transcripts are read via `@anthropic-ai/claude-agent-sdk` (installed as a
  dependency; runs server-side only, never bundled into the browser). FleetView
  uses only its read APIs — `getSessionMessages`, `getSubagentMessages`,
  `listSessions`.
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
  Active work is discovered regardless of this list; watched repos always appear so
  you can see their past sessions before anything is running.
- **`editor`** — CLI used to open files clicked in the chat (default `code`; `cursor` works).
- **`host`** — bind host (default `127.0.0.1`, localhost only). Set `"0.0.0.0"` to reach
  FleetView from other devices on your LAN at `http://<your-ip>:4317`. **FleetView is
  unauthenticated and can approve tool calls in your sessions / open files / read
  `~/.claude` — expose only on a trusted network.** (Env `HOST` overrides config; for dev, `HOST=0.0.0.0 pnpm dev`.)

## How it finds your sessions
Discovery is ownership-independent, so a session you started by typing `claude` in
a terminal shows up the same as any other:
1. `claude agents --json` — every live session (interactive **and** background),
   with its real status (`busy` / `idle` / `waiting`) and what it's waiting for.
2. The SDK's `listSessions()` — every session on disk for a watched repo.
3. `~/.claude/{tasks,teams}` + `subagents/` + `git worktree list` — enrichment:
   task boards, team rosters, and each teammate's live "doing now" line.

Open a project to see its session tiles; open a tile for that session's transcript,
its agents, and its task board.

## Approving tool calls
Click **Install hook** on any project page. That writes a small block into
`~/.claude/settings.json` (user-level, so it covers every repo at once) telling
Claude Code to send permission prompts to FleetView.

After that, when any session asks to run a tool, it shows up as an
**Approve / Always allow / Deny** card, and the project/session tiles badge
**needs approval** so you can spot it from the project list. Your terminal doesn't
prompt — it just proceeds once you click.

Safe by construction:
- **FleetView not running?** The hook fails instantly and your terminal prompts as
  normal. Nothing hangs.
- **Away from the browser?** After 45 seconds FleetView returns "no opinion" and
  the terminal prompts instead. (`FLEETVIEW_PERMISSION_TIMEOUT_MS` to change it.)
- **"Always allow"** writes a real rule to the project's
  `.claude/settings.local.json`, so it still applies next time.
- **Removing it** is one click, and it leaves any hooks you wrote yourself alone.

One caveat: hooks don't run in a folder until you've accepted Claude Code's
"do you trust this folder?" prompt, so a brand-new repo won't send anything until
you've answered that once in the terminal.

## Plan-gated feature agents (opt-in)
If a project's agents follow the convention — write `.fleetview/plan.json` in their
worktree (`{ task, phase, steps }`) — FleetView shows an **approval card** for each
proposed plan and a **self-completing checklist** as the agent works. Progress is
self-reported by each agent, so nothing bottlenecks on polling status. FleetView
badges an agent that's `awaiting-approval`; you answer it in the terminal. Copy the pattern
from `.claude/agents/_shared.md` + `_orchestrator.md` into another project to adopt it.

## Click-to-open files
File paths in transcripts and approval cards are clickable — `POST /api/open` →
`<editor> -g <path>:<line>`.

## Flexibility
FleetView does **not** require a feature-by-folder layout, an orchestrator, or
agent-teams. Any repo you use Claude Code in shows up — a plain single-session chat
is a valid tile with its own transcript. Subagents appear whenever a session spawns
them, whatever they're called; the plan-gated cards are the only opt-in piece.

## Layout
```
src/
  lib/claude-adapter/   # the ONLY code that touches ~/.claude / the CLI (the firewall)
  ui/                   # tokens + shared components (FileLink, …)
  server/               # Node http: composes feature routers + serves the build
  web/                  # React shell composing the feature UIs
  server/bus.ts         # session-keyed SSE bus + parked-permission registry
  features/{projects,task-board,teammates,session-view,hooks}/
.claude/agents/         # FleetView's own feature agents (built with the workflow it visualizes)
```

See **`PLAN.md`** for the architecture and current state, and **`FUTURE.md`** for the
roadmap and known open issues.
