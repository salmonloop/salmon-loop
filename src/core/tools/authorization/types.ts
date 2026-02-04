import type { ExecutionPhase } from '../../types.js';
import type { RiskLevel, SideEffect, ToolSource } from '../types.js';

export interface ToolAuthorizationRequest {
  id: string;
  toolName: string;
  source: ToolSource;
  phase: ExecutionPhase;
  riskLevel: RiskLevel;
  sideEffects: SideEffect[];
  argsSummary?: string;
  argsHash?: string;
  repoRoot: string;
  worktreeRoot?: string;
  attemptId: number;
  model?: string;
  timestamp: number;
}

export interface AuthorizationDecision {
  outcome: 'allow' | 'allow_once' | 'allow_session' | 'deny';
  reason?: string;
  ttlMs?: number;
  persist?: 'repo' | 'user';
  source?: 'auto' | 'allowlist' | 'user' | 'cache';
}

export interface ToolAuthorizationProvider {
  requestAuthorization(request: ToolAuthorizationRequest): Promise<AuthorizationDecision>;
}
