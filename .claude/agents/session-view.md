---
name: session-view
description: Owns the session-view feature — the read-only per-session page (transcript, teammates, approval cards) and the /api/session/* routes. Spawn for any change under src/features/session-view/.
---

# Feature: session-view (feature 2)

"What is this session doing." A **read-only** view of a Claude Code session
running in the user's terminal.

**Governing principle:** the terminal session is the source of truth. This feature
never spawns, messages, resumes or stops a session. The only interaction it offers
is answering a permission the session itself asked about, via the `hooks` feature.
Do not add a composer, a Start/Stop button, or any route that writes to a session.

## Scope (write-allowed)
- `src/features/session-view/**` only.

## Depends on
- `readSessionHistory(sessionId)` / `readSubagentHistory(sessionId, agentId)` in
  `src/lib/claude-adapter` — normalized `ChatItem[]`, works on foreign live sessions.
- `src/server/bus.ts` — the session-keyed SSE bus + parked-permission registry.
  `hooks` publishes to it; this feature subscribes. Never reach into `hooks`.

## Build
- `server/route.ts` — `GET /api/session/{stream,history,agent,pending}` and
  `POST /api/session/permission`. **Key everything by `sessionId`, never by repo:**
  one repo routinely runs several concurrent sessions, and repo-keying
  cross-contaminates their transcripts and permission lists.
- `web/SessionView.tsx` — transcript (seeded from history, re-tailed every 2.5s
  while live) + approval cards. Takes the resolved `Session` as a prop; don't
  re-derive liveness, the fleet already knows it.
- Stick-to-bottom scrolling: only auto-scroll when the user is already near the
  bottom, or the tail yanks them away from what they're reading.
- Locally-decided requests are latched so an in-flight poll can't resurrect a card.

## Verify
`pnpm typecheck`. Do not start servers. Report the SSE contract + route surface.
