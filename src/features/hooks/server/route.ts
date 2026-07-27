// The hook bridge: Claude Code pushes into FleetView instead of FleetView polling.
//
// This is the ONLY inbound write path, and it is not FleetView driving a session —
// it is FleetView answering a question the session asked, over a channel the session
// opened. `POST /api/hooks/permission` HOLDS the response open; the decision the
// user clicks in the browser becomes that response's body.
//
// Contract verified live against CLI 2.1.220 (see PLAN.md "Phase 0 results"):
//   • Transport `type:"http"` is first-class for hooks.
//   • The response MUST be wrapped in `hookSpecificOutput`. An unwrapped body is
//     silently ignored and the TUI prompts as if no hook existed.
//   • The payload has NO tool_use_id and no request id, so we mint our own — the
//     held connection is the identity.
//   • `agent_id`/`agent_type` are present only for subagents; null means the lead.
//   • Claude Code's own answer window is 10 minutes; we deliberately use far less.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolveParentSession, type PermissionDecision, type PermissionRequest } from '../../../lib/claude-adapter/index';
import { park, publish, settlerFor } from '../../../server/bus';
import { hookStatus, installHooks, uninstallHooks } from './install';

/** The port we're actually serving on — the installed hook URL must match it. */
const port = () => Number(process.env.PORT) || 4317;

/** How long we hold a terminal hostage waiting for a click before handing the
 *  decision back to the TUI. Override with FLEETVIEW_PERMISSION_TIMEOUT_MS. */
const DEFAULT_TIMEOUT_MS = 45_000;
const timeoutMs = Number(process.env.FLEETVIEW_PERMISSION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

interface PermissionHookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  permission_suggestions?: unknown[];
  agent_id?: string;
  agent_type?: string;
}

async function readBody(req: IncomingMessage, limit = 1 << 20): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const json = (res: ServerResponse, body: unknown, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * Build the hook's response body.
 *
 * `always` synthesizes a durable rule rather than echoing the CLI's own
 * `permission_suggestions`. Verified live: for Write the suggestion is
 * `[{type:"setMode",mode:"acceptEdits",destination:"session"}]`, which sets a
 * session mode and persists NOTHING — the long-standing "Always allow silently
 * does nothing" bug. Writing an `addRules`/`localSettings` update instead
 * produced `{"permissions":{"allow":["Write"]}}` on disk.
 */
function decisionBody(req: PermissionRequest, decision: PermissionDecision | 'timeout') {
  if (decision === 'timeout') {
    // No opinion: fall through to the terminal's own prompt.
    return {};
  }
  if (decision === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Denied in FleetView.' },
      },
    };
  }
  const d: Record<string, unknown> = { behavior: 'allow', updatedInput: req.input };
  if (decision === 'always') {
    d.updatedPermissions = [{
      type: 'addRules',
      rules: [{ toolName: req.toolName }],
      behavior: 'allow',
      destination: 'localSettings',
    }];
  }
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } };
}

export async function handleHooksRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/hooks/')) return false;
  if (process.env.FLEETVIEW_DEBUG_HOOKS) process.stderr.write(`[hooks] ${req.method} ${url.pathname}\n`);

  try {
    // --- Installer status (the only GET here).
    if (req.method === 'GET' && url.pathname === '/api/hooks/config') {
      json(res, { ok: true, status: await hookStatus(port()) });
      return true;
    }

    if (req.method !== 'POST') { json(res, { ok: false, reason: 'method-not-allowed' }); return true; }
    const body: PermissionHookPayload & { action?: string } = await readBody(req);

    if (url.pathname === '/api/hooks/config') {
      const status = body.action === 'uninstall'
        ? await uninstallHooks(port())
        : await installHooks(port());
      json(res, { ok: !status.error, status, ...(status.error ? { reason: status.error } : {}) });
      return true;
    }

    // --- Permission: hold the response until the user decides.
    if (url.pathname === '/api/hooks/permission') {
      const sessionId = body.session_id;
      const cwd = body.cwd;
      if (!sessionId || !cwd || !body.tool_name) { json(res, {}); return true; }

      // A subagent reports its OWN session id; the card belongs on the parent's page.
      const agentId = body.agent_id ?? null;
      const parentSessionId = agentId ? await resolveParentSession(cwd, agentId) : null;

      const request: PermissionRequest = {
        requestId: randomUUID(),
        sessionId,
        parentSessionId,
        cwd,
        toolName: body.tool_name,
        input: body.tool_input ?? {},
        agentId,
        agentType: body.agent_type ?? null,
        suggestions: body.permission_suggestions,
        receivedAt: new Date().toISOString(),
      };

      const settle = settlerFor(res, (d) => decisionBody(request, d));
      // If the terminal gives up first, stop holding a card the user can't action.
      res.on('close', () => { if (!res.writableEnded) settle('timeout'); });
      park(request, settle, timeoutMs);
      return true; // response deliberately left open
    }

    // --- Everything else: fire-and-forget activity, answered immediately.
    if (url.pathname === '/api/hooks/event') {
      const sessionId = body.session_id;
      if (sessionId) {
        publish(sessionId, {
          kind: 'activity',
          sessionId,
          text: body.hook_event_name ?? 'event',
          at: new Date().toISOString(),
        });
      }
      json(res, {});
      return true;
    }

    json(res, { ok: false, reason: 'not-found' }, 404);
    return true;
  } catch {
    // Never leave a hook hanging on our own bug — an empty object is "no opinion".
    if (!res.writableEnded) json(res, {});
    return true;
  }
}
