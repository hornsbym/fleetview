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
  /** FleetView itself owns a running orchestrator process for this session. */
  owned: boolean;
  /** The owned orchestrator is parked on a tool-permission request awaiting a decision. */
  needsApproval: boolean;
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

/** Live control-plane facts merged into the monitor snapshot so a session FleetView
 *  is driving reads as active even when its team config.json is already gone. */
export interface ControlSessionInfo {
  repo: string;
  sessionId: string | null;
  status: OrchestratorStatus;
  /** Tool-permission requests currently parked awaiting a user decision. */
  pendingApprovals: number;
}
export interface ControlSnapshot {
  sessions: ControlSessionInfo[];
}

// --- Control plane: owning + chatting with an orchestrator (SDK-backed) ---

export type OrchestratorStatus = 'idle' | 'running' | 'stopped' | 'error';

/** What the user decided about a parked tool-permission request. */
export type PermissionDecision = 'allow' | 'deny' | 'always';

/** A tool call awaiting the user's decision (surfaced from the SDK canUseTool hook). */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: unknown;
  /** Bridge-rendered prompt sentence, when present (else build from toolName + input). */
  title?: string;
  /** Short noun phrase for the action, good for compact UI ("Bash", "Read file"). */
  displayName?: string;
  description?: string;
  /** Set when the request originates from a sub-agent rather than the orchestrator. */
  agentId?: string;
}

export interface OrchestratorEvent {
  kind:
    | 'init' | 'assistant' | 'tool_use' | 'result'
    | 'permission' | 'permission_resolved'
    | 'system' | 'error' | 'exit';
  sessionId?: string;
  text?: string;
  tool?: { name: string; input: unknown };
  /** On 'permission'/'permission_resolved': the request in question. */
  permission?: PermissionRequest;
  /** On 'permission_resolved': how it was decided. */
  decision?: PermissionDecision;
  code?: number | null;
  /** On 'result': turn token count (context processed), when reported. */
  tokens?: number;
  raw?: unknown;
}

export interface OrchestratorOptions {
  model?: string;
  /** Resume an existing session id instead of starting fresh. */
  resume?: string;
}

/** One normalized transcript entry, for replaying a past session read-only. */
export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'result'; tokens?: number };

export interface OrchestratorClient {
  readonly repo: string;
  status(): OrchestratorStatus;
  sessionId(): string | null;
  /** Start (optionally resuming a prior session id). */
  start(opts?: { resume?: string }): void;
  send(text: string): void;
  /** Resolve a parked permission request (routes back into the SDK canUseTool hook). */
  respondPermission(requestId: string, decision: PermissionDecision): void;
  /** Currently-parked permission requests (for replay to a late subscriber). */
  pendingPermissions(): PermissionRequest[];
  /** Subscribe to normalized events; returns an unsubscribe fn. */
  onEvent(cb: (e: OrchestratorEvent) => void): () => void;
  stop(): void;
}
