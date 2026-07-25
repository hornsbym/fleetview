# FleetView — deferred / future work

Items intentionally left for after v1.

## Resume-after-restart (Control plane)

FleetView-owned orchestrators are **child processes of the FleetView server**, so they
die when the server stops or restarts (killed cleanly via `stopAll` on shutdown). Today,
restarting FleetView means Starting fresh orchestrators — brand-new sessions with no memory
of the prior conversation. No data is lost (every session transcript stays on disk under
`~/.claude/projects/**`); only *in-session continuity* is lost.

**Goal:** after a FleetView restart, an orchestrator picks up its prior conversation with
full context instead of starting cold.

**Approach:**
- Persist each repo's orchestrator `sessionId` when it starts (e.g., in `~/.fleetview.json`
  or a small state file).
- Add a resume spawn-path to `createOrchestrator` / `OrchestratorClient`: when a prior
  `sessionId` exists for a repo, spawn
  `claude --resume <sessionId> --input-format stream-json --output-format stream-json --verbose …`
  instead of a fresh session.
- Handle stale/invalid session IDs (fall back to a fresh session).
- Decide policy: auto-resume on server boot vs. resume on the next Start.

**Verify first:** `--resume` behavior in headless `stream-json` mode is only partially
confirmed. Run a spike — resume a known `sessionId` headless, confirm context is intact and
streaming continues — before building.

## Display chat context + compact support (Control plane / chat)

Surface how full the orchestrator's context window is, and let the user compact it.

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
