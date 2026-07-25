// Public data shapes for the Monitor plane. These are FleetView's own types —
// deliberately decoupled from Claude Code's internal on-disk shapes, which are
// parsed and normalized in ./internal and never leak past this package.

export interface Task {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  status: 'pending' | 'in_progress' | 'completed' | (string & {});
  blocks?: string[];
  blockedBy?: string[];
}

export interface PlanItem {
  content: string;
  status: string;
}

/** Lifecycle of a plan-gated feature agent (self-reported via .fleetview/plan.json). */
export type TeammatePhase = 'planning' | 'awaiting-approval' | 'working' | 'done' | 'blocked';

/** Shape an agent writes to <worktree>/.fleetview/plan.json (M6 self-reporting). */
export interface AgentPlanFile {
  task?: string;
  phase?: TeammatePhase | (string & {});
  steps?: { id?: string; subject: string; status?: string }[];
  updatedAt?: string;
}

export interface Teammate {
  agentId: string;
  name: string;
  agentType: string;
  isLead: boolean;
  cwd: string | null;
  worktree: string | null;
  desc?: string;
  /** Self-reported lifecycle phase (M6); present only for plan-gated agents. */
  phase?: TeammatePhase | (string & {});
  /** The in-progress task this agent owns, if any. */
  task: { subject: string; activeForm?: string } | null;
  /** One-line "what it's doing now" (latest tool call). */
  action: string | null;
  actionAt: string | null;
  /** Self-completing checklist (this owner's tasks). */
  plan: PlanItem[] | null;
  /** True when its transcript hasn't advanced recently. */
  stale: boolean;
  hasTranscript: boolean;
}

export interface Session {
  id: string;
  live: boolean;
  cwd: string | null;
  leadSessionId: string | null;
  tasks: Task[];
  counts: { pending: number; in_progress: number; completed: number };
  members: Teammate[];
}

export interface Project {
  path: string;
  name: string;
  live: boolean;
  activeTeammates: number;
  sessions: Session[];
}

export interface Fleet {
  generatedAt: string;
  home: string;
  projects: Project[];
}

export interface FleetConfig {
  /** Additional watched repo paths — always shown as projects (additive, not a filter). */
  repos?: string[];
}

// --- Control plane (M4): owning + chatting with an orchestrator ---

export type OrchestratorStatus = 'idle' | 'running' | 'stopped' | 'error';

export interface OrchestratorEvent {
  kind: 'init' | 'assistant' | 'tool_use' | 'result' | 'permission' | 'system' | 'error' | 'exit';
  sessionId?: string;
  text?: string;
  tool?: { name: string; input: unknown };
  /** A permission request from the stream control channel (approver, v1.5). */
  permission?: { requestId: string; toolName: string; toolInput: unknown };
  code?: number | null;
  /** On 'result': session cost so far (USD) and turn token count, when reported. */
  costUsd?: number;
  tokens?: number;
  raw?: unknown;
}

export interface OrchestratorOptions {
  /** CLI permission posture; defaults to 'acceptEdits' (runs without hanging). */
  permissionMode?: string;
  model?: string;
}

export interface OrchestratorClient {
  readonly repo: string;
  status(): OrchestratorStatus;
  sessionId(): string | null;
  start(): void;
  send(text: string): void;
  /** Subscribe to normalized events; returns an unsubscribe fn. */
  onEvent(cb: (e: OrchestratorEvent) => void): () => void;
  stop(): void;
}
