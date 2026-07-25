# FleetView — build plan (v3, final)

A local, cross-project **control-and-monitor** layer over the Claude Code
Agent-Teams / feature-agent-per-worktree workflow. Portable to any repo that
adopts the pattern. Built with the same feature-by-folder methodology it
visualizes — including its own `.claude/agents/`.

Status: spikes complete; monitor-plane prototype validated; M0 scaffolding.

---

## 1. The four features
1. **Multi-project** — view/switch between projects; ≤1 active orchestrator per repo.
2. **Chat with the orchestrator** directly (FleetView is its primary interface).
3. **Task board** — completed / in-progress / upcoming.
4. **Per-teammate live line** — task it's working toward + what it's *doing now* +
   a self-completing checklist; degrades to task-only when finer data is absent.

Non-goals: no database, no cloud, no auth beyond localhost, no chatting to
individual teammates, no full terminal parity.

---

## 2. Architecture — two planes (both validated by spike)

**Monitor plane** (read-only, polls on-disk state; features 1/3/4). Sources:
`teams/<t>/config.json`, `tasks/<t>/<n>.json` (status/owner/activeForm/blocks),
`projects/<enc>/<sid>/subagents/agent-*.{jsonl,meta.json}`, `git worktree list`,
lead `<sid>.jsonl`.

**Control plane** (spawns & owns one orchestrator per repo; feature 2). Proven:
`claude --input-format stream-json --output-format stream-json --verbose` with
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Multi-turn works (stable `session_id`);
a headless-owned orchestrator still spawns worktree feature-agents.

### Permissions (spiked — not a blocker)
- **v1:** run each orchestrator in a configurable **posture** (default
  `acceptEdits`; `bypassPermissions` opt-in) so it never hangs.
- **v1.5 (M4+):** in-UI **approve/deny** via the stream control channel —
  CLI emits `sdk_control_request{subtype:"permission", request_id, tool_name,
  tool_input}`; driver replies `control_response{behavior:"allow"|"deny"}`.
  (Schema is only semi-documented — GH #24594 — so verify empirically in M4.)
- **Slash commands** mostly work over stream-json (`/compact`,`/clear`,`/model`,
  `/config`, skills); interactive ones (`/login`,`/resume`,pickers) don't.

### Constraints baked in
ToS → spawn the CLI, never the SDK. `TodoWrite` absent → checklist = shared task
list by owner. No-op worktrees auto-remove → worktree labels live-only.
Agent-tool spawns skip `members[]` → discover via `subagents/` + `meta.json`.

---

## 3. Robustness to Claude Code changes (design priority)
- **Chat = documented stream-json contract → low risk.**
- **Monitoring = internal on-disk formats → contained:** `src/lib/claude-adapter`
  is the **single module** allowed to touch `~/.claude`, the CLI, or JSONL. A CC
  change → edit one place. Prefer the live stream over file-parsing for owned
  sessions; keep a hooks-based activity option behind the same interface;
  version-aware graceful degradation (fall back to task-list data, never crash);
  fixture tests per CC version.

---

## 4. Tech & principles
- **Single package** (NOT a monorepo) — feature folders inside one project.
- React 19 + TypeScript + Vite 8 (frontend) · Node 20 + TS via tsx (backend, Node
  stdlib http, no framework) · pnpm.
- Local-only (`127.0.0.1`); config `~/.fleetview.json` (repos + per-repo model/posture).
- House rules from NCS: external services behind an interface (→ claude-adapter),
  tokens-only styling (→ src/ui), servers report/UIs decide.

---

## 5. Structure (single package, feature-by-folder)
```
fleetview/
  package.json  tsconfig.json  vite.config.ts  index.html  scripts/dev.mjs
  .claude/agents/  _orchestrator.md _shared.md
                   claude-adapter.md projects.md task-board.md teammates.md orchestrator-chat.md
  src/
    lib/claude-adapter/    # THE firewall: all Claude Code coupling, typed public API
    ui/                    # tokens + shared React primitives + app shell
    server/                # Node http; mounts each feature's router; serves web build
    web/                   # React entry + shell; composes each feature's UI
    features/
      projects/            # feature 1
      task-board/          # feature 3
      teammates/           # feature 4
      orchestrator-chat/   # feature 2
        server/  web/  shared/   # each feature: server route + React UI + shared types
```
Cross-feature rule (mirrors NCS `_shared.md`): features consume `claude-adapter`
+ `ui`, may import each other's components/types, but never touch `~/.claude`/the
CLI directly and never import another feature's internals. `task-board` and
`teammates` read the same adapter snapshot, not each other.

---

## 6. Features — responsibilities & boundaries

### projects (feature 1) — "which fleets exist, and which am I looking at"
The entry surface and cross-project spine. Owns the watched-repo **config**
(`~/.fleetview.json`: which repos to monitor/manage, plus per-repo model +
permission posture), the **discovery** of each repo's active orchestrator session
(and historical sessions), the **project switcher** UI, and the selected-project
state the other features render against. It aggregates the adapter's fleet
snapshot into the top-level `/api/fleet` shape. It decides what a "project" is
(repo root) and enforces the ≤1-active-orchestrator-per-repo assumption. It does
**not** render boards, teammates, or chat — it frames them.

### task-board (feature 3) — "what is the orchestrator trying to accomplish"
Reads the shared task list for the selected session (via the adapter) and renders
it as **upcoming / in-progress / completed**, with owner tags and dependency hints
(`blocks`/`blockedBy`). It's the orchestrator's plan of record. It owns the board
route + board UI only; it reads tasks from the adapter snapshot and never writes
tasks or talks to the CLI. It's also the data source the teammates feature reuses
for the per-owner checklist — so the task shape lives in this feature's `shared/`.

### teammates (feature 4) — "what is each agent doing right now"
The live activity surface. For each teammate (discovered via `subagents/` +
`meta.json`), it renders: **identity** (feature name), **worktree** (when live),
the **task** it's working toward (`activeForm` of its in-progress task), the
**action** it's doing now (latest tool call from its transcript, via the adapter),
and a **self-completing checklist** (that owner's tasks from the task-board data).
It owns the teammate-row components and the liveness/idle/done states. It reads
everything from the adapter; it degrades gracefully (task-only, or hide the action
line) when finer data is missing. It does **not** spawn or message agents.

### orchestrator-chat (feature 2) — "talk to the lead"
The only feature that drives the Control plane. Owns the `OrchestratorClient`
usage (start/send/stream/stop/resume via the adapter), the **SSE** route that
relays assistant text + tool events + results to the browser, the **chat panel**
UI (rendered from the persisted transcript + live stream), lifecycle controls
(start/stop an orchestrator per repo), and the **permission posture** (v1) /
**approve-deny approver** (v1.5, via the control channel). It never reads
`~/.claude` directly — the adapter owns the process and the protocol; this feature
owns the conversation UX. It does not render the board or teammates.

---

## 7. claude-adapter public interface (the contract)
```ts
readFleet(config): Promise<Fleet>               // projects → sessions → { tasks, teammates, lead }
createOrchestrator(repo, opts): OrchestratorClient   // .start .send .onEvent .stop .resume .status
claudeVersion(): string   capabilities(): Caps  // for graceful degradation
```
All path encoding, JSONL parsing, `meta.json`, worktree listing, and the
stream-json protocol are `internal/` and never imported by features.

---

## 8. Milestones & workflow

**Workflow:** fast integration, **no formal PR review gate** (per your call).
Feature agents build in worktrees; the lead reviews briefly and merges quickly
(direct integration). Each milestone leaves a runnable app.

- **M0 — Scaffold + adapter (solo, foundation):** single-package scaffold; port
  the prototype's readers into `src/lib/claude-adapter` behind the typed interface
  (+ meta.json identity, subagent filter, fixtures); minimal `src/ui` shell;
  Node server exposing `/api/fleet`; React shell that renders the project list;
  FleetView's `.claude/agents/`. *Done = `pnpm dev` boots, browser shows real
  projects from `~/.claude`.*
- **M1–M3 — parallel lanes, DOGFOODED:** dispatch FleetView's own feature agents,
  one worktree each — `task-board`, `teammates`, `projects` — coordinated by the
  lead. *Done = each ships its server route + web UI against the adapter.*
- **M4 — orchestrator-chat (dependent lane):** adapter `createOrchestrator` +
  SSE + chat UI + posture; mini-spike the permission control channel, add the
  approver if viable. *Done = chat in-browser → orchestrator replies → its
  feature-agents appear in the fleet.*
- **M5 — polish & package:** states, worktree-live, cost/turn, resume, README,
  `~/.fleetview.json` sample, `npx fleetview`, kill orphaned children.

---

## 9. Definition of done (v1)
Open FleetView → see configured projects → pick one → chat with its orchestrator
→ watch it dispatch feature agents → each teammate shows worktree + task + a live
"doing…" line + checklist → the board fills in as work completes. Local,
portable, all Claude Code coupling isolated in one module.
