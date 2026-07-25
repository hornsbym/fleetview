# Shared coordination rules (FleetView feature agents)

Read by every feature agent at startup, with your own `.claude/agents/<name>.md`
and `PLAN.md`. FleetView is a single-package React+TS+Vite app (frontend) + Node+TS
backend, organized feature-by-folder. It visualizes the Claude Code Agent-Teams
workflow — and is built with that same workflow.

## The firewall rule (most important)
**Only `src/lib/claude-adapter` may touch `~/.claude`, the `claude` CLI, git
worktrees, or transcript JSONL.** Every feature consumes the adapter's typed
interface (`readFleet`, `createOrchestrator`, types) and NEVER reads those sources
directly. If you need data the adapter doesn't expose, ask the lead to extend the
adapter — don't reach around it.

## Feature boundaries
- Write only within your feature folder: `src/features/<name>/` (`server/`,
  `web/`, `shared/`).
- You may import **components/types** from `src/ui` and **types** from
  `src/lib/claude-adapter`. You may import another feature's exported
  components/types, but never its internals, and never another feature's server code.
- Do NOT edit the composition shells — `src/web/App.tsx`, `src/server/main.ts`,
  `package.json`, `vite.config.ts`, tokens. Those are the lead's; surface any needed
  wiring and the lead integrates.

## Styling
Tokens only — consume CSS vars/classes from `src/ui/tokens.css`. No raw hex/px.
Add new tokens by requesting them from the lead.

## Servers report; UIs decide
Server routes return `{ ok, ... }` / data; the React UI decides rendering. No
presentation logic baked into responses.

## Don't run servers
The lead runs `pnpm dev` and verifies. Do not start dev/build servers (port
conflicts). Typecheck your own code with `pnpm typecheck` if useful.

## Comments
Short, essential "why" only (≤~2 sentences). Longer rationale → a feature `NOTES.md`.

## Plan-gated work + progress self-reporting (M6)

For any substantive task, follow this handshake — it keeps the orchestrator off your
back while your progress stays visible:

1. **Research first, don't implement.** Read the relevant code + the task, then form a
   concrete step-by-step plan.
2. **Write your plan to `.fleetview/plan.json` in your worktree** with
   `phase: "awaiting-approval"`, then STOP and return the plan to the orchestrator.
   Do not start implementing yet.
3. **On approval** (the orchestrator resumes you), set `phase: "working"` and begin.
   As you work, keep the file current: mark the step you're on `in_progress` and each
   finished step `completed`. When everything's done, set `phase: "done"`.

You do NOT have `TaskCreate`/`TaskUpdate` (feature agents lack them). Self-report via
the file — that's how FleetView tracks you without the orchestrator polling. Update the
file in place; it's local state, not a chat.

Schema (`<worktree>/.fleetview/plan.json`):
```json
{
  "task": "one-line summary of the overall task",
  "phase": "planning | awaiting-approval | working | done | blocked",
  "steps": [{ "id": "1", "subject": "…", "status": "pending | in_progress | completed" }]
}
```

If any step is high-impact or you're unsure — schema/shared-contract changes, cross-feature
or off-limits edits, dependency/lockfile changes, or anything irreversible — call it out in
the plan (a short note on the step). The orchestrator auto-approves routine plans but routes
flagged/substantial ones to the human, so surfacing risk gets you the right level of review.
