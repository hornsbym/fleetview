# FleetView — deferred / future work

Items intentionally left for later. See `PLAN.md` for what FleetView *is*.

**v2 reset.** FleetView no longer owns a Claude Code process. A large block of v1
roadmap items existed only to make the browser a better place to *drive* Claude
Code — auto-resume on restart, model selection per spawn, compact/context meters,
slash-command coverage, "clicking a live session shouldn't require Resume", the
plan Approve/Request-changes buttons. All of that is **out of scope now**: the
terminal drives, FleetView views. Those items are deleted rather than deferred.

Fixed in v2 and removed from this file: the orchestrator's row vanishing once a
tasks/teams dir appeared; the `'live'` sentinel never resolving to a `Session`;
"Always allow" silently doing nothing; the chat auto-scroll hijack; the duplicated
worse `toolSummary` that made Bash's `description` unreachable; chat-only sessions
being undiscoverable; per-session approval counts collapsing to a boolean; and
assistant text rendering as raw Markdown source; a render loop that hammered the
API at ~270 req/s; and a backgrounded tab polling nothing and never catching up.

---

## Richer "done so far" signals (Session view)

The digest currently recognizes git commits, completed harness tasks, approved
plans and compaction boundaries. Commits are the strongest signal — verifiable and
self-titled — but a session that doesn't commit shows very little. Worth adding:
PR creation (`gh pr create`), test runs that pass, and file-level milestones
(created X, deleted Y). Note the commit parser only matches `git commit` in
*command position* and only trusts a heredoc when `-F -` is present — matching it
anywhere reported a Python heredoc that merely mentioned the string as a commit.

## Read-only teammate pages (Monitor plane)

The **server half is done** — `GET /api/session/agent?sessionId=&agentId=` returns
a subagent's normalized transcript via `getSubagentMessages`. What's missing is the
route + page: `/p/<slug>/s/<sid>/a/<agentId>`, and making each teammate row link
into it. Note the router regex currently accepts **two path segments maximum**, so
it needs widening.

## Push instead of poll (Hook bridge)

`POST /api/hooks/event` accepts the fire-and-forget hooks and the installer
registers them (`Notification`, `SubagentStart`/`Stop`, `TaskCreated`/`Completed`,
`WorktreeCreate`/`Remove`), but the server currently just republishes them as a
generic `activity` event and **nothing consumes it**. The win: drop the 2.5s fleet
poll to something much lazier and let hooks drive the refresh.

Caching has already taken `/api/fleet` off the request path (`~430ms -> 1-3ms`
served from a background-refreshed snapshot), so this is no longer a latency fix —
it's about not rebuilding the fleet every ~1.5s in the background when nothing has
changed. The build still walks every session dir, tails transcripts whose mtime
moved, and shells out to `git worktree list` per repo.

Also worth wiring: `TeammateIdle` exists as a hook event and maps exactly onto the
"is this agent stuck?" question the teammates panel is trying to answer by
timestamp heuristic today.

## Show each agent's branch and worktree at a glance (Monitor plane)

`Session.gitBranch` now exists (from `listSessions`), but **`Teammate` still has no
branch field** and the worktree parser still only matches
`^worktree .*/\.claude/worktrees/agent-<hex>$`, discarding the `branch` and `HEAD`
lines in the same `--porcelain` records. Rewrite it record-aware to capture
`{path, branch, head}` for every record including the repo root, add `branch` to
`Teammate`, handle detached HEAD with a short sha, and render `⎇ agent/foo` as the
primary chip with the path as `title`. **No new subprocess is needed** — the data is
already in output we parse and throw away.

## Stepped, labeled task progress (Task board / teammates)

Replace the progress bar with a **vertical stepper** — one row per milestone with
its label + state (done / in-progress / upcoming), driven by the same
`plan`/`steps` data the checklist uses today.

## Declutter long tool lines (Session view)

There is **no truncation anywhere**: `.oc-tool` / `.oc-tool-arg` have
`overflow-wrap: anywhere` with no `max-height` or line clamp, so a long heredoc
pushes real conversation off-screen. The approval card is the more urgent surface —
`.oc-perm-detail` has the same unbounded styling, so a long command inflates the
card and **pushes the Approve/Deny buttons out of reach**.

Reuse the pattern already in the repo: `TaskBoard`'s collapsible Completed group —
threshold constant + pure predicate in `shared/`, `useState` seeded from it, an
identity latch so the poll can't re-collapse what the user just opened,
`<button aria-expanded aria-controls>` + `hidden` on a kept-mounted body.

## Model-generated session summary (Session view)

The **cheap-derivation half shipped** as the "Working on now" panel: last user
request + current tool call + a trail of recent ones, all from the digest. What's
still open is the *generated* version — a sentence describing what the session is
actually accomplishing, rather than which tool it just ran. Decide whether that's
worth a model call per session before building it.

Also unbuilt: applying either panel to the future read-only teammate pages.

## Summary anchors: why not the top of the turn

A bullet anchors to the assistant message that *confirms* the work — the prose
following the report write, rather than the write itself (a bare `⚙ Write …json`
line) or the user prompt that opened the turn. Anchoring at the top of the turn
was tried and is wrong in the common case: a session that does all its work in
one long turn collapses every bullet onto the same prompt.

## Use page titles to identify sessions and surface attention (UI)

`document.title` is **never set** — `<title>FleetView</title>` in `index.html` is
the only title in the repo, so every route and tab reads the same. With three
project tabs open you can't tell them apart. Shapes the state already supports:
`⚠ needs approval · <project>`, `<project> · <session name>`, `(2) FleetView` on
the project list. Add a `useDocumentTitle` hook called once from `App` — noting
`App` early-returns on `!fleet`, so the derivation must be hoisted above it.

## Make the "needs approval" badge clear immediately (UI)

The sidebar badge persists for up to one fleet-poll interval after you approve,
because the only SSE subscriber is the session page — `App` has no `EventSource`.
Cheapest correct fix: add a lightweight app-level `EventSource` (or lift the
existing one) and bump the existing `refreshKey` on `permission`/
`permission_resolved`. Don't just shorten the poll — that doubles the disk-and-git
cost fleet-wide for a sub-second win.

## Tests and CI (Robustness)

Still **no tests, no runner, no linter, no CI** anywhere in the repo; the only
automated check is `pnpm typecheck`. The adapter's parsing is the obvious first
target — `canonicalSessionId` is pure and trivially testable, and fixture-based
tests over `claude agents --json` output and the hook payload would catch a Claude
Code format change, which is the failure mode `PLAN.md` §3 claims to defend
against. `capabilities()` is likewise still unbuilt.

## Surface in-flight background Bash commands (Session view)

Show a panel of currently-running background commands (`run_in_background: true`)
on the session page — command, duration, and a "still running" indicator.

**Constraint:** Claude Code tracks background processes entirely in-memory within
its own process. There is no hook event, CLI flag, on-disk state, or API that
exposes in-flight commands externally. The only observable signal is the session
transcript JSONL: a `tool_use` with `run_in_background: true` that has no
corresponding `tool_result` is presumed still running.

**Implementation path:** extend the digest scanner to detect unmatched background
Bash `tool_use` entries (match on `tool_use_id`), surface them as a
`backgroundCommands: { command, startedAt, toolUseId }[]` field on the digest,
and render a small collapsible panel on the session page.

**Caveats:**
- Freshness is bounded by the transcript tail poll (currently 2.5s). A command
  that starts and finishes between two polls will never appear.
- If Claude Code changes its transcript format for background commands, this
  breaks silently.
- No way to distinguish "still running" from "process died but CC hasn't written
  the tool_result yet" — both look the same in the JSONL.

**Unblocked by:** a future Claude Code hook like `BackgroundCommandStarted` /
`BackgroundCommandCompleted` would make this real-time and robust. Worth a
feature request at https://github.com/anthropics/claude-code/issues.

## Multi-machine / remote (speculative)

Everything is `127.0.0.1`. Watching sessions on another machine would need an
agent per host plus auth — a genuine product decision, not a refactor.
