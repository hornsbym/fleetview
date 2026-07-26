---
name: orchestrator-chat
description: Owns the orchestrator-chat feature — spawning/owning an orchestrator (SDK-backed), per-session live/historical chat over SSE, UI tool-permission approvals, and resume. Spawn for any change under src/features/orchestrator-chat/.
---

# Feature: orchestrator-chat (feature 2) — M4

"Talk to the lead." The only feature that drives the Control plane.

## Scope (write-allowed)
- `src/features/orchestrator-chat/**` only.

## Depends on (lead delivers first)
- `createOrchestrator(repo, opts)` in `src/lib/claude-adapter` — start/send/onEvent/
  stop/resume + `respondPermission`/`pendingPermissions`, built on the
  `@anthropic-ai/claude-agent-sdk` `query()` API. (Do not spawn the CLI yourself — the
  adapter owns the process, protocol, and permission hook.)
- `readOrchestratorHistory(repo, sessionId)` — replay a past session read-only.

## Build
- `server/route.ts` — `POST /api/orchestrator/{start,stop,message,permission}`,
  `GET /api/orchestrator/{stream,status,history}` (SSE: assistant deltas, tool events,
  results, permission requests/resolutions). `start` takes an optional `resume` id.
- `web/OrchestratorChat.tsx` — one `(repo, sessionId)` panel in two modes: **live**
  (SSE + input + approval cards) and **historical** (read-only replay + Resume). Polls
  status so a just-started orchestrator flips to live before the first message.
- **Permissions (shipped):** spawn `permissionMode: 'default'`; the SDK `canUseTool` hook
  parks each request → `permission` event → an Approve / Always allow / Deny card whose
  answer resolves it (`always` echoes the SDK's `suggestions` as `updatedPermissions`).
  Tiles badge **needs approval**. Rationale in this feature's `DECISIONS.md`.

## Verify
`pnpm typecheck`. Do not start servers. Report the SSE contract + route surface.
