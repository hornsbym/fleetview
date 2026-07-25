// Control plane: spawn & own a `claude` orchestrator over the documented headless
// stream-json protocol, and normalize its stdout into OrchestratorEvents. This is
// the ONLY place FleetView drives the CLI. Multi-turn + worktree-agent spawning
// were validated by spike; permission posture defaults to acceptEdits (no hang).
import { spawn, type ChildProcess } from 'node:child_process';
import type {
  OrchestratorClient, OrchestratorEvent, OrchestratorOptions, OrchestratorStatus,
} from '../types';

const FLAGS = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];

class OrchestratorClientImpl implements OrchestratorClient {
  readonly repo: string;
  private opts: OrchestratorOptions;
  private child: ChildProcess | null = null;
  private _status: OrchestratorStatus = 'idle';
  private _sessionId: string | null = null;
  private buf = '';
  private subs = new Set<(e: OrchestratorEvent) => void>();

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
    for (const cb of this.subs) { try { cb(e); } catch { /* subscriber errors don't break the loop */ } }
  }

  start(): void {
    if (this.child) return;
    const args = [...FLAGS, '--permission-mode', this.opts.permissionMode ?? 'acceptEdits'];
    if (this.opts.model) args.push('--model', this.opts.model);
    this.child = spawn('claude', args, {
      cwd: this.repo,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' },
    });
    this._status = 'running';
    this.child.stdout!.on('data', (d: Buffer) => this.ingest(d.toString()));
    this.child.stderr!.on('data', (d: Buffer) => this.emit({ kind: 'system', raw: { stderr: d.toString().slice(0, 500) } }));
    this.child.on('exit', (code) => { this._status = 'stopped'; this.child = null; this.emit({ kind: 'exit', code }); });
    this.child.on('error', (err) => { this._status = 'error'; this.emit({ kind: 'error', text: String((err as Error)?.message || err) }); });
  }

  send(text: string): void {
    if (!this.child) this.start();
    this.child!.stdin!.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
  }

  stop(): void {
    if (this.child) {
      try { this.child.stdin?.end(); } catch { /* ignore */ }
      this.child.kill();
      this.child = null;
    }
    this._status = 'stopped';
  }

  private ingest(chunk: string) {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let o: any;
      try { o = JSON.parse(line); } catch { continue; }
      this.map(o);
    }
  }

  private map(o: any) {
    if (o.type === 'system' && o.subtype === 'init') {
      this._sessionId = o.session_id ?? null;
      this.emit({ kind: 'init', sessionId: this._sessionId ?? undefined, raw: o });
    } else if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type === 'text' && b.text) this.emit({ kind: 'assistant', text: b.text });
        else if (b.type === 'tool_use') this.emit({ kind: 'tool_use', tool: { name: b.name, input: b.input } });
      }
    } else if (o.type === 'result') {
      const u = o.usage ?? {};
      const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) || undefined;
      this.emit({
        kind: 'result',
        text: typeof o.result === 'string' ? o.result : undefined,
        costUsd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : undefined,
        tokens,
        raw: o,
      });
    } else if (o.type === 'sdk_control_request' && o.request?.subtype === 'permission') {
      // Surfaced for a future approver UI; acceptEdits handles approvals in v1.
      this.emit({ kind: 'permission', permission: { requestId: o.request.request_id, toolName: o.request.tool_name, toolInput: o.request.tool_input } });
    } else {
      this.emit({ kind: 'system', raw: o });
    }
  }
}

export function createOrchestrator(repo: string, opts: OrchestratorOptions = {}): OrchestratorClient {
  return new OrchestratorClientImpl(repo, opts);
}
