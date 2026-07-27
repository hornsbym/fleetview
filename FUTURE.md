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
being undiscoverable; and per-session approval counts collapsing to a boolean.

---

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
poll to something much lazier and let hooks drive the refresh. Each poll re-reads
every task file, tails a 96 KiB window per transcript, reads each worktree's plan
file, and shells out to `git worktree list` — so this is a real cost, and it now
also shells out to `claude agents --json` once per poll.

Also worth wiring: `TeammateIdle` exists as a hook event and maps exactly onto the
"is this agent stuck?" question the teammates panel is trying to answer by
timestamp heuristic today.

## Cache `claude agents --json` (Monitor plane)

Every `/api/fleet` spawns a subprocess. At the 2.5s poll that's ~24 spawns/minute
per open tab. A short TTL cache (≈1s) in `internal/sessions.ts` would collapse
concurrent callers onto one invocation without making the UI feel stale.

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

## Render transcripts as Markdown (Session view)

Assistant messages render as plain text (`linkify` + `white-space: pre-wrap`).
Render Markdown instead — headings, lists, code blocks, inline code, bold, links.
`react-markdown` + `remark-gfm` (v10 / v4, React 19 compatible). Keep the shipped
file-link behaviour by giving it custom `code` (run `linkify` on inline code so
`` `src/foo.ts:12` `` stays clickable) and `a` renderers.

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

## Collapse finished agents (Teammates)

The adapter now reports **every** subagent and carries `stale` through, because
dropping them meant a finished session showed "no teammates". The UI hasn't caught
up: a long session lists every helper agent it ever spawned, flat. Group or collapse
the stale ones (same collapsible pattern as above) so the active agents stay
readable.

## Session summary component (Session view)

A sentence or two describing **what the session you're looking at is doing**,
cutting through the raw tool-call stream. Cheap derivation (latest task
`activeForm` / `.fleetview/plan.json` phase + last tool line) vs. a periodic
model-generated line — decide before building. Applies to session pages and the
future teammate pages.

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

## Multi-machine / remote (speculative)

Everything is `127.0.0.1`. Watching sessions on another machine would need an
agent per host plus auth — a genuine product decision, not a refactor.
