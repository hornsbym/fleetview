# orchestrator-chat — decisions

## Drive the orchestrator through `@anthropic-ai/claude-agent-sdk`, not a raw spawn

**Context.** v1 spawned `claude --input-format stream-json …` directly and ran with
`--permission-mode acceptEdits`. That auto-approves file edits but **auto-denies Bash**
(and git/pnpm/typecheck) in headless mode — the orchestrator couldn't verify its own
work ("This command requires approval", no way to grant it). We wanted the user to
approve/deny/always-allow tool calls from the FleetView UI instead.

**Findings (spikes).**
- The raw CLI in stream-json mode does **not** emit an interactive permission
  `control_request` we can answer — under both `default` and `manual` it silently
  auto-denies. v2.1.220 has **no `--permission-prompt-tool` flag**.
- The **official** path for programmatic permission handling is the SDK's `query()`
  with a `canUseTool(toolName, input, opts)` callback returning
  `{behavior:'allow', updatedInput, updatedPermissions?}` or `{behavior:'deny', message}`.
- Spiked and confirmed: `canUseTool` fires for Bash; returning `allow` runs the command;
  `opts.suggestions` (a `PermissionUpdate[]`) is exactly what "Always allow" returns as
  `updatedPermissions`; multi-turn streaming input, `resume`, and
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` all coexist with the callback.

**Decision.** `createOrchestrator` uses the SDK. `canUseTool` parks each request and
emits a `permission` event; the UI shows an approval card (Approve / Always allow / Deny);
the answer resolves the parked promise. The SDK stays **inside** the claude-adapter
firewall — features still consume the same `OrchestratorClient` interface. Real posture
is enforced per-tool by `canUseTool`, so we spawn with `permissionMode: 'default'` ("ask").

**Consequence.** The orchestrator can now run real verification (typecheck/tests/git)
after a click. Adds one dependency (`@anthropic-ai/claude-agent-sdk`), server-side only —
web imports from the adapter are type-only, so the SDK never enters the browser bundle.

## Read-only history via `getSessionMessages`, not hand-parsed JSONL

A dead session's page replays its transcript via the SDK's `getSessionMessages(sessionId)`
(official, format-robust) mapped to `ChatItem[]`, rather than tailing the JSONL ourselves.

## "Live" no longer depends on the CLI's team `config.json`

The CLI deletes `~/.claude/teams/<id>/config.json` when a lead exits, so monitor-plane
liveness (keyed on that file) showed a FleetView-driven session as "inactive" even while
running. Liveness now also merges the control plane: `readFleet(config, controlSnapshot)`
marks a session live/owned when FleetView holds a running client for it, and synthesizes a
tile for a running orchestrator that hasn't created a team/tasks yet.

## Cost metric dropped

The chat's per-turn marker shows token count only — the USD estimate is meaningless on a
Pro/Max subscription (it's a CLI-billing figure), so it was removed.
