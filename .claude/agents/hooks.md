---
name: hooks
description: Owns the hooks feature — the PermissionRequest bridge (held HTTP responses), fire-and-forget activity hooks, and the ~/.claude/settings.json installer. Spawn for any change under src/features/hooks/.
---

# Feature: hooks — the permission bridge

Receives Claude Code's native hooks over `type: "http"`. This is FleetView's only
inbound write path, and it is not FleetView driving a session — it is FleetView
answering a question the session asked, over a channel the session opened.

## Scope (write-allowed)
- `src/features/hooks/**` only.

## Contract (verified live against CLI 2.1.220 — do not "simplify" these)
- The response **must** be wrapped in `hookSpecificOutput`. An unwrapped body is
  silently ignored and the TUI prompts as if no hook existed.
- The payload has **no tool_use_id and no request id** — mint one; the held HTTP
  connection is the identity.
- `agent_id`/`agent_type` are present **only for subagents**; `null` means the
  lead asked. A subagent reports its **own** `session_id`, so use
  `resolveParentSession(cwd, agentId)` to group the card under the page the user
  is actually looking at.
- **Fail open.** The hook blocks the terminal while we hold it. Time out well
  below Claude Code's 10-minute window (currently 45s) and return `{}` — "no
  opinion" — so the TUI prompts instead. Also release on `res.close` and on
  server shutdown. Never leave a terminal blocked on FleetView.
- **`always` must synthesize** `{type:'addRules', rules:[{toolName}],
  behavior:'allow', destination:'localSettings'}`. Do NOT echo the CLI's
  `permission_suggestions` — for Write it's a session-scoped `setMode` that
  persists nothing, which is the old "Always allow does nothing" bug.

## Installer
`install.ts` writes a **user-level** block to `~/.claude/settings.json` (one
opt-in covers every repo). It must merge, never clobber: preserve hand-written
hooks and unrelated keys, mark our own entries so uninstall is exact, and write
via temp-file + rename so a crash can't truncate the user's settings.

Note hooks do not run at all until the user accepts Claude Code's workspace-trust
prompt for a folder — the setup UI must say so.

## Verify
`pnpm typecheck`. Do not start servers. Do not write to the real
`~/.claude/settings.json` while testing — point `HOME` at a temp dir.
