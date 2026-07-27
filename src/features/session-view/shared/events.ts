// Wire contract between the session-view server routes and its React UI.
// Type-only re-exports keep the SDK out of the browser bundle.
export type {
  ChatItem,
  SessionEvent,
  PermissionDecision,
  PermissionRequest,
} from '../../../lib/claude-adapter/types';

import type { ChatItem, PermissionRequest } from '../../../lib/claude-adapter/types';

export interface OkResponse { ok: boolean; reason?: string }
export interface HistoryResponse extends OkResponse { items?: ChatItem[] }
export interface PendingResponse extends OkResponse { pending?: PermissionRequest[] }

export interface PermissionBody {
  requestId: string;
  decision: 'allow' | 'deny' | 'always';
}
