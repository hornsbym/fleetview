# FleetView — deferred / future work

Items intentionally left for after v1.

## Auto-resume after a FleetView restart (Control plane)

**Shipped already:** *manual* resume of any past session — open its tile and hit **Resume**;
`createOrchestrator({resume})` spawns via the SDK's `resume` option, continuing the same
session id. The headless `--resume`/SDK-resume spike is confirmed (context intact, streaming
continues).

**Still future:** FleetView-owned orchestrators are child processes of the server, so they
die on server restart (clean `stopAll` on shutdown). Nothing is lost (transcripts persist
under `~/.claude/projects/**`), but the running client is gone. The remaining work is making
this *automatic*:
- Persist each repo's active orchestrator `sessionId` (e.g. a small state file).
- On boot (or next open), reattach by resuming that id instead of starting cold; handle
  stale ids by falling back to fresh.
- Policy: auto-resume on boot vs. resume on next Start.

## Model management + delegation-first orchestration (Control plane / methodology)

Make model choice an explicit **orchestrator responsibility**, and bias the orchestrator
toward delegating rather than doing.

**Model policy (per-role, per-phase):**
- **Orchestrator stays on Opus** — it's the coordination brain; keep it sharp.
- **Subagents PLAN on Opus, EXECUTE on Sonnet.** Planning is where reasoning pays off;
  execution is mechanical and cheaper/faster on Sonnet. So a plan-gated feature agent runs
  its planning phase on Opus, then its implementation phase on Sonnet.
- Mechanism: the orchestrator sets each subagent's model via the `Agent`/`Task` tool `model`
  arg (per-spawn override; wins over agent-def frontmatter). Model can't change mid-agent, so
  the Opus→Sonnet handoff means the plan and the execution are **separate dispatches**: plan
  (Opus) → approve → execute (Sonnet), rather than one long-lived agent. Encode this in
  `.claude/agents/_orchestrator.md` (+ `_shared.md`) as the default model policy.
- Optional FleetView UI later: surface/override the chosen model on the plan-approval card and
  a model selector for the orchestrator itself (`OrchestratorOptions.model` already exists).

**Delegation-first orchestrator instructions:** update `.claude/agents/_orchestrator.md` so the
orchestrator's strong default is to **delegate work to subagents**. An orchestrator doing the
task itself should be the *exception* (small/one-off/glue work, or when spinning up an agent
costs more than it saves), not the norm — the norm is: decompose → dispatch → coordinate →
integrate. This pairs with the model policy above (cheap Sonnet execution makes delegation the
economical default too).

## Surface chat-only past sessions (Control plane)

A stopped session that never created a team/tasks (pure chat) leaves no monitor-plane tile,
so it can't be resumed from the UI. Enrich the project view with `listSessions(dir)` from the
SDK to list *all* recent sessions on disk (merged with active work), each Resume-able. Also
resolves the brief "project shows idle until the first message assigns a session id" window.

## Display chat context + compact support (Control plane / chat)

Surface how full the orchestrator's context window is, and let the user compact it.
(The `result` event now emits a per-turn `tokens` total, a starting point for the meter.)

**Display context:** show a usage meter in the chat header — current context size vs. the
model's context window. Source: the `result` event's `usage` (`input_tokens` +
`cache_read_input_tokens` + `cache_creation_input_tokens` ≈ current prompt/context size) and
`modelUsage[model].contextWindow` (e.g. 200k / 1M). The adapter would add these to the
`result` `OrchestratorEvent` (e.g. `contextTokens`, `contextWindow`); the chat renders a small
"context: 45% of 200k" bar, updated each turn.

**Compact support:** `/compact` (and `/context`, `/clear`) work over stream-json as user
messages, so add a **Compact** button that sends `/compact` to the orchestrator to compress its
history. Optionally: nudge when context is high (e.g. > 80%), and surface auto-compaction when
Claude Code does it on its own (render it as a system line in the transcript).

**Verify first:** confirm `/compact` sent via `--input-format stream-json` actually compacts
(vs. being treated as literal text), and confirm which `usage` fields best represent "current
context size" across turns.

## Read-only teammate chat pages (Monitor plane)

We can't *chat* with teammates (FleetView doesn't own their processes), but reading what a
feature agent is actually doing is valuable. Give each teammate its own **read-only page**,
the same shape as the orchestrator session page. Reuse the read-only transcript rendering
(`fromHistory` path in `OrchestratorChat`, or a shared component) plus the file-link + tool
lines. Source: the SDK's `getSubagentMessages(sessionId, agentId)` (and/or the already-known
`subagents/agent-<id>.jsonl` transcript the monitor plane discovers). Route idea:
`/p/<slug>/s/<sid>/a/<agentId>`; make each teammate row on the session page a link into it.
Poll/tail for live updates (no SSE ownership needed).

## Chat summary component (Control plane / chat)

A component that describes, in a sentence or two, **what the chat you're looking at is doing** —
cutting through the noise of the raw tool-call stream. Applies to both the orchestrator chat and
the (future) teammate pages. Options to explore: derive it cheaply from recent activity (latest
task `activeForm` / `.fleetview/plan.json` phase + last tool line), or generate a periodic
one-line summary. Keep it glanceable — a header strip like "Implementing the attention badges —
editing ProjectSwitcher.tsx", refreshed as the chat advances. Decide cheap-derivation vs.
model-generated before building.

## Bug: orchestrator tile vanishes once it spawns a feature agent (Monitor plane)

When the orchestrator spawns a feature agent, the orchestrator's own preview tile disappears —
probably not what we want. Likely in the fleet assembly / liveness merge (`internal/fleet.ts`):
once a team/tasks or subagents show up, the synthesized owned-orchestrator tile may stop being
emitted, or the session's identity shifts so the control-plane merge no longer matches it.
Investigate how the owned/synth session reconciles with a discovered team session once teammates
exist; the owned orchestrator should stay visible throughout. (Repro: start a session, have it
spawn one feature agent, watch the project tiles.)

## Stepped, labeled task progress (Task board / teammates)

Replace the task/checklist **progress bar** with a **stepped progress indicator** — each
milestone in the task clearly labeled, likely arranged **vertically** rather than as a
horizontal bar. Think a vertical stepper: one row per step with its label + state
(done / in-progress / upcoming), driven by the same data the checklist uses today
(`plan`/`steps` from `.fleetview/plan.json` or the owner-grouped task list). Lives in the
teammates/task-board feature UI + tokens.

## Render chat responses as Markdown (Control plane / chat)

Assistant responses currently render as plain text (`linkify` + `white-space: pre-wrap`) —
render them as **Markdown** instead (headings, lists, code blocks, inline code, bold, links).
Plan: add `react-markdown` + `remark-gfm` (v10 / v4 confirmed compatible with React 19), used
only in `OrchestratorChat` (server-side imports stay type-only, so no bundle concern). Keep the
shipped **file-link** feature working through it: give react-markdown custom `code` (run
`linkify` on inline code so `` `src/foo.ts:12` `` stays clickable) and `a` (file-ish href →
`openInEditor`, else external link) renderers — bare paths in plain prose may lose their link,
which is acceptable since Claude usually wraps paths in backticks. Add scoped Markdown CSS to
the bubble (`.oc-bubble`). Apply to assistant bubbles (live + history); user/tool lines can stay
plain.

## Fix chat auto-scroll hijack (Control plane / chat)

Scrolling up to read older messages snaps you back to the latest. Cause: the auto-scroll effect
in `OrchestratorChat` force-sets `scrollTop = scrollHeight` on every `items`/`pending` change
(and those change on the SSE stream + the 2.5s status poll), overriding manual scroll. Fix with
**stick-to-bottom**: track whether the user is near the bottom (an `onScroll` handler on
`.oc-transcript`, threshold ~60px) and only auto-scroll when they are; otherwise leave their
scroll position alone. Re-stick when they scroll back to the bottom.
