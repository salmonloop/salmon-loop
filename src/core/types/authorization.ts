import type { ExecutionPhase } from './execution.js';

export type AuthorizationOutcome = 'allow' | 'allow_once' | 'allow_session' | 'deny' | 'pending';

export type AuthorizationDecisionSource =
  | 'auto'
  | 'allowlist'
  | 'user'
  | 'cache'
  | 'cli'
  | 'hook'
  | 'unknown';

export type AuthorizationPersistScope = 'repo' | 'user';

export interface AuthorizationDecisionRecord {
  callId: string;
  toolName: string;
  phase: ExecutionPhase;
  outcome: AuthorizationOutcome;
  source?: AuthorizationDecisionSource;
  reason?: string;
  ttlMs?: number;
  persist?: AuthorizationPersistScope;
  riskLevel?: string;
  sideEffects?: string[];
  timestamp: string;
}
