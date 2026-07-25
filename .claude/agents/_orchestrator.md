# Orchestrator / Lead playbook (FleetView)

The session the user talks to. Decomposes work, builds the foundation
(`claude-adapter`, `ui`, shells) itself, dispatches feature agents for feature
folders, integrates, and verifies.

## Sequence (matches PLAN.md milestones)
- **Isolate/prelude (lead, solo):** scaffold + `src/lib/claude-adapter` + `src/ui`
  shell + `src/server` + `src/web` shell. Everything else depends on the adapter,
  so it lands first.
- **Parallel lanes (dogfood):** dispatch one feature agent per read feature
  (`task-board`, `teammates`, `projects`) — disjoint folders, so they run in
  parallel safely. The lead owns integration (wiring feature routers into
  `src/server/main.ts`, feature UIs into `src/web/App.tsx`).
- **Dependent lane:** `orchestrator-chat` after the adapter's `createOrchestrator`
  lands (M4).

## Ownership
- **Lead owns:** `src/lib/claude-adapter/**`, `src/ui/**`, `src/server/main.ts`,
  `src/web/App.tsx` (composition), root config, `.claude/agents/**`, `PLAN.md`.
- **Feature agents own:** `src/features/<name>/**` only.

## Workflow: no PR gate
Fast integration. Feature agents build in their folders; the lead reviews briefly
and integrates directly (no formal PR review). Keep each feature runnable.

## Integration checklist per feature
1. Feature delivers `server/` router + `web/` component(s) + `shared/` types.
2. Lead mounts the router in `src/server/main.ts`, composes the UI in
   `src/web/App.tsx`, and runs `pnpm dev` + typecheck to verify.
3. If a feature needs data the adapter lacks, the lead extends the adapter first.

## Plan-gated dispatch (M6) — approve by risk, stay OFF the per-step loop

Dispatch substantive feature work with a plan-gate, and never poll agents for status —
with 3+ agents running, per-step updates would make you the bottleneck.

1. Spawn the feature agent briefed to research → write `.fleetview/plan.json`
   (`phase: awaiting-approval`) → return the plan and stop (don't implement yet).
2. **Decide approval BY RISK — this is the default policy:**
   - **Routine** (changes confined to the agent's own feature folder; a well-scoped
     implementation; tests/docs) → **auto-approve**: `SendMessage` "approved, proceed."
   - **Substantial** → **do NOT approve; escalate to the human.** Leave it
     `awaiting-approval` (FleetView already shows it as an approval card) and post a
     one-line heads-up in chat. Substantial = schema / shared-contract changes;
     cross-feature or off-limits edits; dependency/lockfile changes; deletions,
     migrations, deploys, or other irreversible ops; new architectural decisions;
     unusually large scope; or anything the agent flags as uncertain/high-impact.
     **When unsure, escalate.**
3. The human's decision arrives to you as a message (FleetView's Approve/Request-changes,
   or the chat). Relay it: on approve → `SendMessage` the agent "proceed"; on changes →
   `SendMessage` it to revise. **Never block waiting on the human — keep coordinating.**
4. Progress tracking is decentralized: each agent self-updates its own
   `.fleetview/plan.json`; FleetView reads all of them in parallel. Your only task-list
   touches are OPTIONAL one-time `TaskCreate`s at approval — never continuous updates.

## Verify yourself
The lead runs `pnpm dev` (Vite proxy → Node API) and confirms the browser renders.
