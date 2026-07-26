// Control plane: own & drive a `claude` orchestrator through the official
// @anthropic-ai/claude-agent-sdk `query()` API — the ONLY place FleetView drives
// the CLI. The SDK is used (over a raw spawn) for one reason the raw stream-json
// protocol can't give us: the `canUseTool` hook, which lets FleetView intercept
// every tool-permission request and route it to the UI for approval / always-allow /
// deny, instead of the CLI silently auto-denying Bash/git/pnpm in headless mode.
import {
  query,
  type CanUseTool,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  OrchestratorClient, OrchestratorEvent, OrchestratorOptions, OrchestratorStatus,
  PermissionDecision, PermissionRequest,
} from '../types';

/** Push-driven async iterable: the SDK consumes it as streaming input while we
    push user messages onto it turn by turn (and close it to end the session). */
function makeInput() {
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  const iterator: AsyncIterableIterator<SDKUserMessage> = {
    next() {
      if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
      if (done) return Promise.resolve({ value: undefined as never, done: true });
      return new Promise((resolve) => {
        wake = () => resolve(queue.length ? { value: queue.shift()!, done: false } : { value: undefined as never, done: true });
      });
    },
    [Symbol.asyncIterator]() { return this; },
  };
  const kick = () => { if (wake) { const w = wake; wake = null; w(); } };
  return {
    iterator,
    push(m: SDKUserMessage) { queue.push(m); kick(); },
    close() { done = true; kick(); },
  };
}

interface Parked {
  resolve: (r: PermissionResult) => void;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  req: PermissionRequest;
}

class OrchestratorClientImpl implements OrchestratorClient {
  readonly repo: string;
  private opts: OrchestratorOptions;
  private _status: OrchestratorStatus = 'idle';
  private _sessionId: string | null = null;
  private q: Query | null = null;
  private input: ReturnType<typeof makeInput> | null = null;
  private abort: AbortController | null = null;
  private subs = new Set<(e: OrchestratorEvent) => void>();
  private parked = new Map<string, Parked>();

  constructor(repo: string, opts: OrchestratorOptions = {}) {
    this.repo = repo;
    this.opts = opts;
  }

  status(): OrchestratorStatus { return this._status; }
  sessionId(): string | null { return this._sessionId; }

  onEvent(cb: (e: OrchestratorEvent) => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }
  private emit(e: OrchestratorEvent) {
    for (const cb of this.subs) { try { cb(e); } catch { /* one subscriber can't break the fan-out */ } }
  }

  pendingPermissions(): PermissionRequest[] {
    return [...this.parked.values()].map((p) => p.req);
  }

  private canUseTool: CanUseTool = (toolName, input, o) =>
    new Promise<PermissionResult>((resolve) => {
      const req: PermissionRequest = {
        requestId: o.requestId, toolName, input,
        title: o.title, displayName: o.displayName, description: o.description, agentId: o.agentID,
      };
      this.parked.set(o.requestId, { resolve, input, suggestions: o.suggestions, req });
      this.emit({ kind: 'permission', permission: req });
      // If the turn is aborted while parked, fail closed so nothing hangs forever.
      o.signal?.addEventListener('abort', () => {
        if (this.parked.delete(o.requestId)) resolve({ behavior: 'deny', message: 'Aborted.' });
      });
    });

  respondPermission(requestId: string, decision: PermissionDecision): void {
    const p = this.parked.get(requestId);
    if (!p) return;
    this.parked.delete(requestId);
    if (decision === 'deny') {
      p.resolve({ behavior: 'deny', message: 'Denied by user in FleetView.' });
    } else {
      p.resolve({
        behavior: 'allow',
        updatedInput: p.input,
        // "Always allow": echo the SDK's own suggestions so it won't ask again this session.
        ...(decision === 'always' && p.suggestions ? { updatedPermissions: p.suggestions } : {}),
      });
    }
    this.emit({ kind: 'permission_resolved', permission: p.req, decision });
  }

  start(opts?: { resume?: string }): void {
    if (this.q) return;
    const resume = opts?.resume ?? this.opts.resume;
    this.abort = new AbortController();
    this.input = makeInput();
    this._sessionId = resume ?? null;
    this.q = query({
      prompt: this.input.iterator,
      options: {
        cwd: this.repo,
        // Real posture is enforced per-tool by canUseTool; 'default' just means "ask".
        permissionMode: 'default',
        canUseTool: this.canUseTool,
        abortController: this.abort,
        ...(resume ? { resume } : {}),
        ...(this.opts.model ? { model: this.opts.model } : {}),
        env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' },
      },
    });
    this._status = 'running';
    void this.run(this.q);
  }

  private async run(q: Query) {
    try {
      for await (const m of q) this.map(m);
      this._status = 'stopped';
      this.emit({ kind: 'exit', code: 0 });
    } catch (err) {
      // A stop()-triggered abort surfaces here too — report it as a clean exit.
      if (this.abort?.signal.aborted) { this._status = 'stopped'; this.emit({ kind: 'exit', code: 0 }); }
      else { this._status = 'error'; this.emit({ kind: 'error', text: String((err as Error)?.message || err) }); }
    } finally {
      this.q = null;
    }
  }

  private map(m: SDKMessage) {
    if (m.type === 'system' && m.subtype === 'init') {
      this._sessionId = m.session_id ?? this._sessionId;
      this.emit({ kind: 'init', sessionId: this._sessionId ?? undefined, raw: m });
    } else if (m.type === 'assistant') {
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text) this.emit({ kind: 'assistant', text: b.text });
        else if (b.type === 'tool_use') this.emit({ kind: 'tool_use', tool: { name: b.name, input: b.input } });
      }
    } else if (m.type === 'result') {
      this.emit({ kind: 'result', tokens: usageTokens((m as { usage?: unknown }).usage), raw: m });
    }
    // user (tool_result) + other system messages: not surfaced to the chat transcript.
  }

  send(text: string): void {
    if (!this.q) this.start();
    this.input!.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
  }

  stop(): void {
    // Release anything parked so the SDK's turn can unwind, then abort + close input.
    for (const [id] of this.parked) this.respondPermission(id, 'deny');
    try { this.abort?.abort(); } catch { /* ignore */ }
    try { this.input?.close(); } catch { /* ignore */ }
    this.q = null;
    this._status = 'stopped';
  }
}

/** Sum the token fields a result reports (input + output + cache) — the real
    context processed this turn, a more honest "how big was that" than input+output. */
function usageTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
  const total = n('input_tokens') + n('output_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens');
  return total || undefined;
}

export function createOrchestrator(repo: string, opts: OrchestratorOptions = {}): OrchestratorClient {
  return new OrchestratorClientImpl(repo, opts);
}
