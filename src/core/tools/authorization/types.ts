import type { ExecutionPhase } from '../../types/runtime.js';
import type { RiskLevel, SideEffect, ToolSource } from '../types.js';

export interface ToolAuthorizationRequest {
  id: string;
  toolName: string;
  toolIntent?: string;
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
  source?: 'auto' | 'allowlist' | 'user' | 'cache' | 'cli' | 'hook';
}

export interface ToolAuthorizationProvider {
  requestAuthorization(request: ToolAuthorizationRequest): Promise<AuthorizationDecision>;

  /**
   * Optional non-blocking variant used by parallel schedulers and UIs that can surface
   * an approval prompt asynchronously.
   *
   * When `kind === 'pending'`, callers should treat the tool call as blocked (AUTH_REQUIRED)
   * and retry later after the user responds.
   */
  requestAuthorizationDeferred?: (
    request: ToolAuthorizationRequest,
  ) => Promise<
    | { kind: 'decision'; decision: AuthorizationDecision }
    | { kind: 'pending'; challenge: string; message: string }
  >;

  /**
   * Optional helper for non-blocking execution loops to await a previously requested authorization
   * decision by request id.
   */
  waitForAuthorization?: (
    requestId: string,
    signal?: AbortSignal,
  ) => Promise<AuthorizationDecision | null>;
}
