# FleetView — architecture & current state

A local, cross-project **visualization** of the Claude Code sessions running on
your machine. Portable to any repo. Built with the same feature-by-folder
methodology it visualizes — including its own `.claude/agents/`.

**Governing principle: the Claude Code terminal session is the sole source of
truth. FleetView is a view onto it.** FleetView never spawns a session, never
sends it a message, never resumes or stops it. Everything the browser shows is
derived from state the session already produces.

The one apparent exception isn't one. Approving a tool call is not FleetView
driving a session — it's FleetView *answering a question the session asked*, over
a channel *the session opened* (Claude Code's `PermissionRequest` hook). If a
proposed write path can't be described that way, it doesn't belong in FleetView.

**Status: v2.** v1 owned an orchestrator process per repo and offered a browser
chat; that was the wrong center of gravity and has been removed. This document
describes what FleetView *is*; **`FUTURE.md`** is the roadmap. Where this file and
the code disagree, the code wins — fix this file.

---

## 1. The four features
1. **Multi-project** — view/switch between projects; every session in each, discovered.
2. **Read-only session view** — a session's transcript as it runs, plus approval
   cards for permissions that session asked about.
3. **Task board** — completed / in-progress / upcoming.
4. **Per-teammate live line** — task it's working toward + what it's *doing now* +
   a self-completing checklist; degrades to task-only when finer data is absent.

Non-goals: no database, no cloud, no auth beyond localhost, **no sending messages
to any session**, no spawning, no terminal parity.

---

## 2. Architecture — monitor plane + hook bridge

**Monitor plane** (read-only; all four features). Discovery order matters:

1. **`claude agents --json`** → every LIVE session (interactive *and* background),
   with real liveness (`status`, `waitingFor`, `kind`, `name`). TTY-free, honours
   `--cwd`, and includes SDK-spawned sessions, so discovery is uniform.
2. **SDK `listSessions({dir})`** → every session on disk for a watched repo.
3. **`~/.claude/{tasks,teams}`** → **enrichment only** (task boards, team rosters).

v1 discovered from (3) *alone*, which is why terminal-started sessions were
invisible: a session with neither a `tasks/` nor a `teams/` dir produced no tile.
Measured on a dev machine, three concurrently-live sessions in one repo appeared
in neither directory.

Also read: `~/.claude/projects/<enc>/<sid>/subagents/agent-*.{jsonl,meta.json}`,
`git worktree list --porcelain`, and each session's `<sid>.jsonl` transcript.

**Hook bridge** (the only inbound write path; feature 2's approval cards). Claude
Code pushes into FleetView via native `type: "http"` hooks aimed at
`127.0.0.1:<port>`. Installed user-level in `~/.claude/settings.json`, so one
opt-in covers every repo.

### Permissions — as shipped
`POST /api/hooks/permission` **holds the HTTP response open**; the decision you
click in the browser becomes that response's body. Verified end-to-end against
CLI 2.1.220 — the terminal proceeds and never shows its own dialog, rendering
"Allowed by PermissionRequest hook" instead.

Contract details that are easy to get wrong (all verified live):
- The response **must** be wrapped in `hookSpecificOutput`. An unwrapped body is
  **silently ignored** and the TUI prompts as if no hook existed.
- The payload has **no `tool_use_id` and no request id**, so FleetView mints its
  own `requestId` — the held connection is the identity.
- `agent_id`/`agent_type` are present **only for subagents**; `null` means the
  session's lead asked. A subagent reports its **own** `session_id`, so
  `resolveParentSession()` maps it back to the page you're looking at via
  `<parent>/subagents/agent-<id>.jsonl`.
- **Fail-open is a correctness requirement.** The hook *blocks the terminal* while
  we hold it. FleetView being down is fine (connection refused → instant TUI
  prompt), but FleetView running while you're away is not — so we time out at 45s
  (`FLEETVIEW_PERMISSION_TIMEOUT_MS`) and return "no opinion", far below Claude
  Code's own 10-minute window. `releaseAll()` on shutdown does the same.
- **`always` synthesizes a rule** rather than echoing the CLI's
  `permission_suggestions`. For `Write` the suggestion is
  `{type:"setMode",mode:"acceptEdits",destination:"session"}`, which persists
  **nothing** — the long-standing "Always allow silently does nothing" bug.
  Writing `{type:'addRules', rules:[{toolName}], behavior:'allow',
  destination:'localSettings'}` instead produces `{"permissions":{"allow":["Write"]}}`
  on disk.

**Two operational constraints:** hooks do not run until Claude Code's *workspace
trust* prompt is accepted (a brand-new repo emits nothing until then — the setup
strip says so), and headless `claude -p` never fires `PermissionRequest` at all
(it denies without consulting the hook). Neither affects normal terminal use.

### Constraints baked in
`TodoWrite` is absent for feature agents → the checklist is the shared task list
by owner, or the agent's self-reported `.fleetview/plan.json`. No-op worktrees
auto-remove → worktree labels are live-only. Agent-tool spawns skip `members[]` →
teammates are discovered via `subagents/` + `meta.json`. The CLI deletes
`teams/<id>/config.json` on lead exit → liveness comes from `claude agents --json`,
not the team file. Subagent discovery is gated on `cwd` alone, **not** liveness:
v1 dropped stale non-worktree agents *in the adapter*, so any session whose agents
had finished rendered "no teammates" and the data was gone for good. The adapter
now reports every agent and carries `stale` through; the **teammates panel renders
only the running ones**, since it answers "who is working right now". Filtering in
the UI rather than the adapter keeps the history available for a future view
(servers report / UIs decide).

---

## 3. Robustness to Claude Code changes (design priority)

- **Reading = documented SDK contract → low risk** (`getSessionMessages`,
  `getSubagentMessages`, `listSessions`).
- **Hooks = typed, documented contract → low risk.** `claude agents --json` is a
  supported scriptable surface. Both are far more durable than the on-disk formats.
- **Monitoring = internal on-disk formats → contained:** `src/lib/claude-adapter`
  is the **single module** allowed to touch `~/.claude`, the `claude` CLI, git
  worktrees, or transcript JSONL. A CC change → edit one place. `internal/transcripts.ts`
  is deliberately defensive: bounded reads (96 KiB tail, 16 KiB head), every parse
  try/caught to `null`, never throws.

**Honest gaps in this story:**
- **`capabilities()` was never built.** Version-aware graceful degradation is
  aspirational; `claudeVersion()` exists but feeds only `/api/health`.
- **There are no tests and no CI.** No test files, no runner, no linter, no
  workflow config anywhere in the repo. The only automated check is
  `pnpm typecheck` (`tsc --noEmit`), run by hand. The "fixture tests per CC
  version" defense this section depends on does not exist yet.

---

## 4. Tech & principles
- **Single package** (NOT a monorepo) — feature folders inside one project.
- React 19 + TypeScript + Vite 8 (frontend) · Node 20.19+ via tsx (backend, Node
  stdlib `http`, no framework) · pnpm.
- Runtime deps are five: `@anthropic-ai/claude-agent-sdk` (pinned `0.3.220`, no
  caret), `react`, `react-dom`, plus `react-markdown` + `remark-gfm` for rendering
  assistant text. The markdown pair was added deliberately — hand-rolling a parser
  is a known source of edge-case bugs (nested lists, fences, tables) — at a cost of
  ~157 KB raw / ~47 KB gzip on the bundle. Keep new runtime deps this rare.
- Local-only by default (`127.0.0.1`); config `~/.fleetview.json`.
- House rules from NCS: external services behind an interface (→ `claude-adapter`),
  tokens-only styling (→ `src/ui/tokens.css`), servers report / UIs decide.

**Security posture:** the server has no auth, no CORS handling, and no CSRF
protection, and it can approve tool calls in your Claude Code sessions, read
`~/.claude`, write the hook block into `~/.claude/settings.json`, and open files
via the local editor. `host: "0.0.0.0"` is an explicit opt-in for LAN access and
should be treated as trusted-network-only.

---

## 5. Structure (actual)
```
fleetview/
  package.json  tsconfig.json  vite.config.ts  index.html
  bin/fleetview.mjs        # `fleetview`: vite build → tsx server → open browser
  scripts/dev.mjs          # parallel [api] tsx watch + [web] vite, prefixed output
  .claude/agents/  _orchestrator.md  _shared.md
                   projects.md  task-board.md  teammates.md  session-view.md
  src/
    lib/claude-adapter/    # THE firewall: all Claude Code coupling, typed public API
      index.ts  types.ts
      internal/  paths.ts  fleet.ts  transcripts.ts  orchestrator.ts  history.ts
    ui/                    # tokens.css + FileLink.tsx (openInEditor, linkify)
    server/                # main.ts (http + route dispatch + static) · bus.ts · open.ts
    web/                   # main.tsx · App.tsx (shell) · App.css · router.ts
    features/
      projects/            # feature 1 — server/ shared/ web/
      task-board/          # feature 3 — shared/ web/          (no server/)
      teammates/           # feature 4 — web/                  (no server/, no shared/)
      session-view/        # feature 2 — server/ shared/ web/  (read-only)
      hooks/               # the hook bridge — server/ web/    (no shared/)
```
Only `session-view` and `projects` have all three subfolders. `task-board`
is presentational + pure shared logic; `teammates` is presentational only (its
`relativeTime.ts` lives in `web/`, not `shared/`). Both receive data via
`/api/fleet`, which is why neither needs a server route.

Cross-feature rule (mirrors `_shared.md`): features consume `claude-adapter` +
`ui`, may import each other's components/types, but never touch `~/.claude`/the
CLI directly and never import another feature's internals. In practice
`teammates` imports nothing from `task-board` — the checklist arrives
pre-derived as `Teammate.plan` from the adapter.

---

## 6. Features — responsibilities & boundaries

### projects (feature 1) — "which fleets exist, and which am I looking at"
The entry surface and cross-project spine. Owns the watched-repo **config**
(`~/.fleetview.json`: `{ repos, editor?, host? }`), the **project switcher** +
add/remove UI, `GET/POST /api/config`, the **attention** derivation
(`projectAttention` → awaiting-approval / blocked / stalled), and slug generation
for clean URLs. It does **not** render boards, teammates, or chat — it frames them.

*Note:* per-repo `model` and `permission posture` were planned config fields and
were never built.

### task-board (feature 3) — "what is the orchestrator trying to accomplish"
Pure presentational `<TaskBoard tasks={Task[]}/>`: **in progress / upcoming /
completed**, owner tags, `blocks`/`blockedBy` dependency badges, a
`<BoardSummary>` meter, and a collapsible Completed group
(`COMPLETED_COLLAPSE_MIN = 5`, with an identity latch so the 2.5s poll can't
re-collapse what the user just opened). No fetching, no `~/.claude` access.

### teammates (feature 4) — "what is each agent doing right now"
The live activity surface. Per teammate: **identity**, **worktree** (when live),
self-reported **phase**, the **task** it's working toward, the **action** it's
doing now (latest tool call, with a relative timestamp), and a **self-completing
checklist**. Leads are pinned first. Renders plan-approval Approve /
Request-changes buttons when `phase === 'awaiting-approval'` — which work by
**posting a natural-language instruction to the orchestrator's chat**, not via any
agent API. Degrades gracefully on nulls. It does not spawn or message agents.

### session-view (feature 2) — "what is this session doing"
A **read-only** page per session: its transcript (seeded from
`readSessionHistory`, re-tailed every 2.5s while live), the session's name /
kind / status, and the **approval cards** for permissions it asked about. Owns the
`/api/session/*` routes — `stream` (SSE), `history`, `agent` (one subagent's
transcript), `digest`, `pending`, and `permission` (the decision). There is **no
composer** and no start/stop/resume. It never reads `~/.claude` directly.

Also renders the two orientation panels in the side column — **Working on now**
(1-3 sentences of prose, never a command) and **Done so far** (a bulleted list) —
so a human returning to a session can re-enter its context without reading the
transcript. Both come from one `SessionDigest`; see §7 and §9.

### hooks — the permission bridge
Receives Claude Code's native hooks. `POST /api/hooks/permission` parks the
request and holds the response; `POST /api/hooks/event` is fire-and-forget
activity. Also owns the **installer** (`GET/POST /api/hooks/config` +
`<HookSetup>`), which merges a user-level block into `~/.claude/settings.json`,
preserving hand-written hooks and removing cleanly.

---

## 7. claude-adapter public interface (the contract)
```ts
readFleet(config?: FleetConfig, pending?: PendingSnapshot): Promise<Fleet>
readSessionHistory(sessionId: string): Promise<ChatItem[]>
readSubagentHistory(sessionId: string, agentId: string): Promise<ChatItem[]>
liveSessions(cwd?: string): Promise<LiveSession[]>
knownSessions(dir: string, limit?: number): Promise<KnownSession[]>
canonicalSessionId(raw: string, known: Iterable<string>): string | null
resolveParentSession(cwd: string, agentId: string): Promise<string | null>
isWaiting(s: LiveSession): boolean
claudeVersion(): string
export * from './types'
```
**The interface is read-only by design** — there is deliberately no way to spawn,
message, resume or stop a session through it.

### Session digest — compaction-proof by construction
`readSessionDigest(sessionId, cwd)` derives "what it's doing now" and "what it has
finished" from the transcript. This matters for durability: **compaction does not
delete history from the JSONL** — verified against a real compacted session
(18.6 MB, 8 `compact_boundary` entries, 949 entries still present before the
first). Compaction shrinks what the *model* can see; the file keeps everything. So
the digest needs no separate persistence.

Reading a whole multi-MB file per poll would be far too expensive, so the scan is
**incremental**: each transcript keeps a byte cursor and only newly-appended lines
are parsed (the same trick Claude Code uses for its own job tracking —
`linkScanOffset` in `~/.claude/jobs/<id>/state.json`). Measured: 20 ms for the
first full scan of a 2.3 MB transcript, ~1 ms per poll thereafter. Partial trailing
lines are left for the next pass rather than parsed as garbage.

### Session self-report — the agent's own account
`<repo>/.fleetview/sessions/<CLAUDE_CODE_SESSION_ID>.json` — `{ now, done[], updatedAt }`.
When present it is **authoritative**: a sentence the agent wrote about its own
intent beats anything inferred from which tool happened to run last, the same
precedence `plan.json`'s `phase` already has. Without it, FleetView falls back to
git commits and completed tasks, which can only show what a session *did*, not what
it *meant*. `CLAUDE_CODE_SESSION_ID` is exported to every session and tracks the
current id (it follows a `/clear` fork), so the filename is always correct.
Convention documented in `.claude/agents/_shared.md`.

### Session identity — one id, one alias form
The canonical id is always the **full session UUID**. Task directories spell it
two ways: the full UUID, or `session-<first 8 hex>` (verified:
`session-2211c310` ↔ `2211c310-1989-46ed-be98-73382241f378`).
`canonicalSessionId()` passes full UUIDs through and resolves the truncated form
by prefix against the session registry, refusing to guess on ambiguity and
returning `null` for orphans — truncated dirs whose transcript was cleaned up.
Those are dropped rather than rendered as ghost tiles.
`readFleet`'s second parameter is a `PendingSnapshot` — `{ pendingBySession }`,
the hook bridge's parked-permission counts. It is the only live fact not derivable
from Claude Code's own state; liveness itself comes from `claude agents --json`.
`Session.attached` (v1's `owned`) now means "a live process was observed", not
"FleetView spawned it".

The session-keyed SSE bus lives in `src/server/bus.ts` — server infrastructure, not
a feature, because `hooks` publishes to it and `session-view` subscribes. It is
keyed by **session**, not repo: one repo routinely runs several sessions at once,
and v1's repo keying cross-contaminated their transcripts and permission lists.

All path encoding, JSONL parsing, `meta.json`, worktree listing, and the SDK
protocol are `internal/` and never imported by features.

---

## 8. HTTP surface (actual)

| Method | Path | Owner |
|---|---|---|
| GET | `/api/fleet` | server (inline) — `readFleet(config, controlSnapshot())` |
| GET | `/api/health` | server (inline) — `{ ok, claude: version }` |
| GET/POST | `/api/config` | projects — read / `{action:'add'\|'remove', path}` |
| GET | `/api/session/stream?sessionId=` | session-view — SSE, `Last-Event-ID` replay, 15s heartbeat |
| GET | `/api/session/history?sessionId=` | session-view — `ChatItem[]` |
| GET | `/api/session/agent?sessionId=&agentId=` | session-view — one subagent's `ChatItem[]` |
| GET | `/api/session/digest?sessionId=&cwd=` | session-view — `SessionDigest` (doing now + done so far) |
| GET | `/api/session/pending?sessionId=` | session-view — parked `PermissionRequest[]` |
| POST | `/api/session/permission` | session-view — `{requestId, decision}` |
| POST | `/api/hooks/permission` | hooks — Claude Code's `PermissionRequest`; **response held open** |
| POST | `/api/hooks/event` | hooks — fire-and-forget activity hooks |
| GET/POST | `/api/hooks/config` | hooks — installer status / `{action:'install'\|'uninstall'}` |
| POST | `/api/open` | server — `{path, repo?, line?, col?}` → `<editor> -g path:line` |
| GET | everything else | static from `dist/`, SPA fallback to `index.html` |

Routes reply `200 { ok: false, reason }` for most failures rather than HTTP error
codes. `POST /api/orchestrator/start` already accepts `model`, but **no UI sends
it** — and `manager.ensure()` only applies options when it first creates a
client, so a later model change would be silently ignored.

Clean URLs are client-routed via the History API: `/`, `/p/<slug>`,
`/p/<slug>/s/<sid>`, plus the sentinel `/p/<slug>/s/live` for a
just-started session. The router regex accepts **two path segments maximum**.

---

## 9. The M6 plan-gate convention (opt-in)

Feature agents self-report progress so the orchestrator never bottlenecks polling
status. An agent writes `<worktree>/.fleetview/plan.json`:
```json
{
  "task": "one-line summary of the overall task",
  "phase": "planning | awaiting-approval | working | done | blocked",
  "steps": [{ "id": "1", "subject": "…", "status": "pending | in_progress | completed" }]
}
```
Flow: research → write the plan with `phase: "awaiting-approval"` → **stop** →
on approval set `phase: "working"` and keep the file current → `phase: "done"`.
Any high-impact step must be flagged.

The orchestrator gates by **risk**: routine work confined to the agent's own
feature folder is **auto-approved**; anything substantial (shared contracts,
cross-feature edits, dependency changes, irreversible ops, or anything the agent
flagged) is **escalated to the human** and left `awaiting-approval` for FleetView
to render. When unsure, escalate. The orchestrator must never block waiting on
the human.

A present `phase` makes the plan file **authoritative** over harness-derived task
grouping, and `awaiting-approval` / `blocked` feed the sidebar attention badges.
Copy the pattern from `.claude/agents/_shared.md` + `_orchestrator.md` to adopt it
in another repo. FleetView works without it — the cards are the only opt-in piece.

---

## 10. What shipped

- **M0** — scaffold + adapter behind the typed interface; minimal `src/ui`;
  Node server exposing `/api/fleet`; React shell; FleetView's own `.claude/agents/`.
- **M1–M3** — `task-board`, `teammates`, `projects`, dogfooded as parallel
  feature-agent lanes, one worktree each.
- **M4** — `orchestrator-chat`: `createOrchestrator` + SSE + chat UI. *(Removed in v2 —
  superseded by `session-view` + the hook bridge.)*
- **M5** — states, worktree-live labels, per-turn tokens, README,
  `~/.fleetview.json`, `fleetview` command, clean shutdown of child processes.
- **M6** — UI permission approvals, per-session pages, resume, clean URLs, and the
  plan-gated approval cards + self-completing checklists.

Workflow: fast integration, **no formal PR review gate**. Feature agents build in
worktrees; the lead reviews briefly and merges directly. Each milestone leaves a
runnable app.

---

## 11. Definition of done (v1) — met

Open FleetView → see configured projects → pick one → open a session page → chat
with its orchestrator, approving tool calls as they arrive → watch it dispatch
feature agents → each teammate shows worktree + task + a live "doing…" line +
checklist → the board fills in as work completes → past sessions replay read-only
and can be resumed. Local, portable, all Claude Code coupling isolated in one
module.

**Known open issues** are tracked in `FUTURE.md`, including a correctness cluster
worth reading before extending the fleet merge or the chat: the live-session
sentinel never resolving to a `Session`, the orchestrator's own row disappearing
once a team or task dir appears, and "Always allow" not persisting for most tools.
