---
name: orchestrator-chat
description: Owns the orchestrator-chat feature — spawning/owning an orchestrator and chatting with it (SSE) incl. permission posture. Spawn for any change under src/features/orchestrator-chat/. (M4 — after the adapter's createOrchestrator lands.)
---

# Feature: orchestrator-chat (feature 2) — M4

"Talk to the lead." The only feature that drives the Control plane.

## Scope (write-allowed)
- `src/features/orchestrator-chat/**` only.

## Depends on (lead delivers first)
- `createOrchestrator(repo, opts)` in `src/lib/claude-adapter` — start/send/onEvent/
  stop/resume over `claude --input-format stream-json --output-format stream-json`.
  (Do not spawn the CLI yourself — the adapter owns the process + protocol.)

## Build
- `server/route.ts` — `POST /api/orchestrator/:repo/{start,stop,message}` and
  `GET /api/orchestrator/:repo/stream` (SSE: assistant deltas, tool events, results).
- `web/Chat.tsx` — chat panel rendering the persisted transcript + live SSE stream,
  an input box, and start/stop lifecycle controls.
- **Permission posture (v1):** per-repo `--permission-mode` (default `acceptEdits`).
- **Approver (v1.5):** if the stream surfaces `sdk_control_request{subtype:permission}`,
  render approve/deny and reply `control_response{behavior}` via the adapter.
  (Verify the exact schema empirically first — semi-documented, GH #24594.)

## Verify
`pnpm typecheck`. Do not start servers. Report the SSE contract + route surface.
